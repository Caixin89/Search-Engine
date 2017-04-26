//---Imports---
var express = require("express");
var app = express();
var solrNode = require("solr-node");
var fs = require("fs");
var jsdom = require("jsdom");
var csv = require("fast-csv");
var spell = require("./spell.js");

//---Function definitions---
function call_jsdom(source, callback) {
jsdom.env(
    source,
    [ 'js/jquery.js', 'js/jquery-ui.js'],  // (*)
    function(errors, window) {  // (**)
        process.nextTick(
            function () {
                if (errors) {
                    throw new Error("There were errors: "+errors);
                }
                callback(window);
            }
        );
    }
);
}

function getFileNameFromPath(filePath)
{
	var tmp = filePath.split('/');
	return tmp[tmp.length - 1];	
}

function getUrl(filename)
{
	if (filename in fileToUrlMapper)
	{
		return fileToUrlMapper[filename];
	}
	return "";
}


function normalizeWhitespace(str) {
	return str.replace(/\s+/, ' ');
}

function getNumberOfMatchingQueryTerms(sentence, queryTerms) {
	var count = 0;	
	for (var it = queryTerms.values(), q=null; q=it.next().value; )
	{
		var regexPattern = new RegExp("(\\b)(" + q + ")(\\b)", "im");
		if (regexPattern.exec(sentence))
		{
			count += 1;
		}
	}
	return count;
}

//Wrote my own sentence extraction because need to handle abreviation at the end, e.g. "U.S.A."
function extractSentence(str, offset) {
	var pattern = /[A-Z](?:[A-Za-z0-9,"'\(\)\-]|\s)+?([.!?])/mg;
	pattern.lastIndex = offset;
	var res = pattern.exec(str);
	var sentence = "";
	if (res && res.length > 0)
	{
		sentence = res[0]; 		
		if (res[1] == '.')
		{
			if (res.index + sentence.length + 1  < str.length)
			{			
				var i = pattern.lastIndex - 2;
				var abbrev = "";
				while (i + 1 < str.length)
				{
					if (/[A-Z]\./.exec(str[i] + str[i + 1]))
					{
						abbrev += str[i] + str[i + 1];
						i += 2;
					}
					else
					{
						break;
					}
				}
				if (abbrev && i < str.length && /[A-Z]/.exec(str[i]))
				{
					var tmp = extractSentence(str, i);

					if (tmp[1] == i + tmp[0].length) //If the next found sentence starts on index i
					{
						return [sentence + abbrev.slice(2, abbrev.length) + tmp[0], tmp[1]];
					}
				}
				return [sentence + abbrev.slice(2, abbrev.length), pattern.lastIndex + abbrev.length - 2];							
			}

		}
		return [sentence, pattern.lastIndex];
	}
	return [sentence, offset];
}

function markQueryTerms(sentence, queryTerms) {
	for (var it = queryTerms.values(), q=null; q=it.next().value; ) 
	{
		var regexPattern = new RegExp("(\\b)(" + q + ")(\\b)", "im");	
		sentence = sentence.replace(regexPattern, '$1<span style="background-color: yellow">$2</span>$3');
	}
	return sentence;
}

function getSnippet(filename, queryTerms) {
	var content = fs.readFileSync(filename, 'utf8');
	if (!content)
	{
		return "";
	}
	//Body text appears after occurence of "zn-body__paragraph" so drop everything before
	var tmp = content.split("zn-body__paragraph");
	if (tmp && tmp.length > 1)
	{		
		content = tmp.slice(1, tmp.length).join("");
		
	}
	//console.log(queryTerms);
	var maxNumberOfMatchedTerms = 0;
	var minSentenceLen = 8;
	var sentenceFound = "";
	var matchOffset = 0;
	while (true)
	{
		var tmp = extractSentence(content, matchOffset);
		matchOffset = tmp[1];		
		var matchedStr = tmp[0];
		if (!matchedStr || 0 === matchedStr.length)
		{
			return sentenceFound;
		}
		if (matchedStr.split(/\s+/).length + 1 > minSentenceLen)
		{
			//get sentences with most number of query term matches
			var tmp = getNumberOfMatchingQueryTerms(matchedStr, queryTerms);
			if (tmp > maxNumberOfMatchedTerms)
			{
				maxNumberOfMatchedTerms = tmp;
				sentenceFound = matchedStr;
			}
			if (maxNumberOfMatchedTerms == queryTerms.length)
			{
				return sentenceFound;
			}
		}
	}	
}

function generateResultHtml(start, ranking, query, queryResult)
{
	var rankStr = "Default";
	if (ranking == "pr")
	{
		rankStr = "Page Rank";
	}
	if (queryResult.numFound == 0)
	{
		return "<h3>(" + rankStr + ") No results found</h3><ol>";
	}
	if (queryResult.docs.length == 0)
	{
		return "<h3>(" + rankStr + ") Displaying 0 results out of " + queryResult.numFound + ":</h3><ol>";
	}
	var startIdx = start + 1;
	var lastIdx = startIdx + queryResult.docs.length - 1;
	var str = "<h3>(" + rankStr + ") Displaying results " + startIdx + "-" + lastIdx +  " out of " + queryResult.numFound + ":</h3><ol>";
	var queryTerms = new Set(query.split(/\s+/)); //split on whitespace
	for (var i = 0; i < queryResult.docs.length; ++i) {
		var fileName = getFileNameFromPath(queryResult.docs[i].id);
		var url = getUrl(fileName);
		var title = queryResult.docs[i].title;
		var desc = "";	
		if (queryResult.docs[i].description && queryResult.docs[i].description.length > 0)
		{			
			desc = queryResult.docs[i].description[0];
		}
		var snippet = getSnippet(queryResult.docs[i].id, queryTerms);
		if (snippet.length == 0)
		{
			snippet = desc;			
		}
		var bulletStyle = 'margin-bottom:30px;';
		if (i < queryResult.docs.length)
		{
			bulletStyle = 'margin-bottom:10px;';	
		}
		str += '<li style="' + bulletStyle +'"><p class="resultTitle">'
		    + '<a href="' + url + '">' + title
		    + '</a></p><p class="resultUrl"><a style="color:green;" href="' + url +'">' + url + '</a> (' + fileName
	            + ')</p><p class="resultSnippet">' + markQueryTerms(normalizeWhitespace(snippet), queryTerms)
		    + '</p></li>';
	}
	str += "</ol>";		
	return str;
}

function encodeQueryToUri(query) {
	return encodeURIComponent(query).replace(/%20/g, "+");
}

function generateNextAndPrevLinks(query, start, ranking, totalNumOfResults, spellcheck)
{	
	//console.log("start: " + start);
	//console.log("totalNumOfResults: " + totalNumOfResults);
	var baseUrl = '/result.html?Query=' + encodeQueryToUri(query) + '&Ranking=' + ranking + '&Spell=' + spellcheck;
	var str = "";
	if (start - 10 >= 0)
	{
		var prevUrl = '<h3 style="float:left;margin-top:0;"><a href="' + baseUrl + '&Start=' + (start - 10) + '">Prev</a></h3>';
		str += prevUrl;
	}	
	if (start + 10 < totalNumOfResults)
	{
		var nextUrl = '<h3 style="float:right;margin-top:0;"><a href="' + baseUrl + '&Start=' + (start + 10) + '">Next</a></h3>';
		str += nextUrl;
	}
	//console.log(str);	
	return str;
}

function generateSpellCorrectHtml(suggestion, query, ranking) {
	var suggestionUrl = '/result.html?Query=' + encodeQueryToUri(suggestion) + '&Ranking=' + ranking + '&Spell=true';
	var queryUrl = '/result.html?Query=' + encodeQueryToUri(query) + '&Ranking=' + ranking + '&Spell=false';
	var str = '<h3>Showing results for <a href="' + suggestionUrl + '"><u><i>' + suggestion + '</i></u></a></h3>';
	str += '<h4>Search instead for <a href="' + queryUrl + '"><u><i>' + query + '</i></u></a></h4>';
	return str;
}

function getSpellCorrect(query) {
	var terms = query.toLowerCase().split(/\s+/);
	var correctedTerms = spellChecker.correct.apply(this, terms);
	var str = "";
	for (var i = 0; i < terms.length; ++i)
	{
		str += correctedTerms[terms[i]] + " ";
	}
	return str.trim();
}

function searchAndDisplay(query,res, start, rows, ranking, spellcheck) {
	var startInt = parseInt(start);
	var sortParam = "";
	if (ranking == "pr")
	{
		sortParam = {pageRankFile: 'desc'};
		console.log("using page rank");
	}
	var suggestionHtml = "";
	if (spellcheck != "false")
	{
		var suggestedSpelling = getSpellCorrect(query);
		if (suggestedSpelling != query.toLowerCase())
		{
			suggestionHtml = generateSpellCorrectHtml(suggestedSpelling, query, ranking);
			query = suggestedSpelling;
		}
	}
	var strQuery = solrClient.query().q(query).start(startInt).rows(rows).sort(sortParam);
	solrClient.search(strQuery, function (err, result) {
		if (err) {
			console.log(err);
			return;
		}
		console.log("Found " + result.response.numFound + " results");
		var resultHtml = generateResultHtml(startInt, ranking, query, result.response);
		var nextPrevHtml = generateNextAndPrevLinks(query, startInt, ranking, result.response.numFound, spellcheck);		
		var htmlSource = fs.readFileSync(__dirname + "/views/index.html", "utf8");
		call_jsdom(htmlSource, function(window) {
			var $ = window.$;	
			$('#profilepic').remove();
			$(suggestionHtml).appendTo("#bodycenter");
			$(resultHtml).appendTo("#bodycenter");
			$(nextPrevHtml).appendTo("#bodycenter");
			res.send("<!DOCTYPE html>" + $("<div>").append($("html").clone()).remove().html());
		});
			
	});
}

function setupHttp()
{
	app.get("/",function(req,res){
	  res.redirect("/index.html");
	});
	app.get("/result.html",function(req,res,next){
	  if ("Query" in  req.query)
	  {
		var query = req.query['Query'];
		var start = 0;
		var ranking = "";
		var spellcheck = "true";
		if ("Start" in req.query && isNormalInteger(req.query['Start']))
		{
			start = req.query['Start'];
		}
		//console.log("Start: " + start);
		if ("Ranking" in req.query)
		{
			ranking = req.query["Ranking"]
		}
		if ("Spell" in req.query)
		{
			spellcheck = req.query["Spell"]
		}
	  	console.log('Query: ' + query);
	  	console.log('Spellcheck: ' + spellcheck);
		searchAndDisplay(query, res, start, 10, ranking, spellcheck);
	  }
	  else
	  {
	  	next();
	  }
	});
	app.get("/suggest", function(req,res){
		var str = "";
		if ("Param1" in req.query)
		{
			str = req.query["Param1"];
		}
		//Get a JSON response from Solr
		var strQuery = solrClient.query().q(str);
		solrClient._requestGet("suggest", strQuery, function(err, result) {
			res.json(result); //Forward the JSON to front-end
		});
	});
	app.use("/css", express.static(__dirname + "/css"));
	app.use("/fonts", express.static(__dirname + "/fonts"));
	app.use("/js", express.static(__dirname + "/js"));
	app.use("/pictures", express.static(__dirname + "/pictures"));
	app.use("/", express.static(__dirname + "/views"));
	app.use("*",function(req,res){
	  res.redirect("/404.html");
	  //console.log("error 404!");
	});

	app.listen(3000,function(){
	  console.log("Live at Port 3000");
	});
}

function isNormalInteger(str) {
    var n = Math.floor(Number(str));
    return String(n) === str && n >= 0;
}

//---code starts here---
//train spelling corrector
var spellChecker = spell.NorvigSpellChecker();
spellChecker.train(fs.readFileSync("corpus.txt", 'utf8').split(" "));

// Create Solr client
var solrClient = new solrNode({
    host: '127.0.0.1',
    port: '8983',
    core: 'myexample',
    protocol: 'http',
    debugLevel: 'ERROR' // log4js debug level paramter 
});

var fileToUrlMapper = {};
csv
.fromPath(__dirname + "/mapCNNDataFile.csv")
.on("data", function(data){
	fileToUrlMapper[data[0]] = data[1];
})
.on("end", function(){
	setupHttp();
});

