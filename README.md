# README #

### CNN Search Engine for USC CSCI 572 HW4 & HW5 ###
This is a search engine project for USC CSCI572 (Information Retrieval and Web Search) class. The backend uses Node.js and the search is handled by Apache Solr.

#### Node.js Packages ####
Listed in package.json. You can just do a "npm install".

#### Solr configuration ####
-Server runs on localhost port 3000 (Server.js)
-Solr runs on localhost port 8983
-Current implementation is based on an offline folder of CNN HTML files which is not included
-mapCNNDataFile.csv is used by server to map file name to actual online URL for display in search result
-external_pageRankFile.txt is used by Solr to have a static Page Rank ranking of pages (User can select the different ranking methods in a combo box)
-Refer to IndexingwithTIKAV3.pdf on how to index files
-Spelling correction is implemented in spell.js and requires a corpus file named corpus.txt (Refer to SpellAndAutocompleteInSolr.pdf)
-For more details on setting up Solr and the details of this project, refer to Homework4.pdf and Homework5.pdf

#### Starting up ####
You can either do a "npm start" or a "node Server.js" in the project directory.

