// in order to add npm package: docker exec -it node /bin/sh
// debugging: docker logs node

const http = require('http');
const fs = require('fs');
const markview = require('./markview');
const static = require('./static');
const { notFound } = require('./notfound');
const runningRequests = [];

const requestListener = function (req, res) {
    const stopwatchStart = performance.now();
    const logFile = fs.createWriteStream(__dirname + '/access.log', { flags: 'a' });

    // where the real path starts; e.g. /node/ = 1, /script/node/app/ = 3
    const pathOffset = 1;
    const urlWithoutQuery = req.url.replace(/\?.*$/, '');
    const urlParts = urlWithoutQuery.replace(/^\/|\/$/g, '').split('/');

    runningRequests.push(urlWithoutQuery);

    switch (urlParts[pathOffset]) {
        case 'view':
            markview.getView(urlParts, pathOffset + 1, res);
            break;

        case 'source':
            markview.getSource(urlParts, pathOffset + 1, res);
            break;

        case 'cards':
        case 'anki':
        case 'quizlet':
        case 'cards-json':
            markview.getCards(urlParts, pathOffset + 1, res);
            break;

        case 'static':
            static.getFile(urlParts, pathOffset + 1, res);
            break;

        default:
            notFound(res, 'Mode not found');
            break;
    }

    res.on('finish', function () {
        const index = runningRequests.indexOf(urlWithoutQuery);
        
        if (index !== -1) {
            runningRequests.splice(index, 1);
        }

        const stopwatchEnd = performance.now();
        const date = new Date();
        logFile.write(date.toISOString() + '\t' + urlWithoutQuery + '\t' + (stopwatchEnd - stopwatchStart) + '\t' + req.headers['user-agent'] + '\t' + JSON.stringify(runningRequests) + '\n');
    });
}

const server = http.createServer(requestListener);
server.listen(8080);
