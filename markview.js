const https = require('https');
require('dotenv').config();
const marked = require('marked');
const marktex = require('./marktex');
const { notFound } = require('./notfound');
const { getHeadingList } = require('marked-gfm-heading-id');

const repositories = {
    'notes-ipp': 'vitkolos/notes-ipp',
    'grsc': {
        'url': 'https://mff.share.grsc.cz',
        'beer': 'Dej si pauzu od učení a podepiš <a href="https://portal.gov.cz/e-petice/713-cisla-linky-na-leve-strane-vozidel-pid">tuhle cool petici</a>.',
    }
};

const rawContentTypes = {
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    txt: 'text/plain; charset=utf-8',
    csv: 'text/plain; charset=utf-8',
    tsv: 'text/plain; charset=utf-8',
    json: 'application/json; charset=utf-8',
};

function getView(originalPath, pathOffset, res) {
    loadGithubData(originalPath, pathOffset, res, pagify);
}

function getSource(originalPath, pathOffset, res) {
    loadGithubData(originalPath, pathOffset, res, markdown => markdown);
}

function getCards(originalPath, pathOffset, res) {
    loadGithubData(originalPath, pathOffset, res, cardify);
}

function loadGithubData(originalPath, pathOffset, res, processor) {
    const defaultBranch = 'main';
    let path = originalPath.slice(pathOffset);

    if (path[0] in repositories) {
        const isGithub = typeof (repositories[path[0]]) == 'string';

        if (path[1] == 'blob') {
            path.splice(1, 1);
            res.writeHead(302, {
                'Location': '/' + originalPath.slice(0, pathOffset).join('/') + '/' + path.join('/')
            });
            res.end();
        } else if (path.length == 1) {
            res.writeHead(302, {
                'Location': isGithub
                    ? ('/' + [...originalPath, defaultBranch].join('/') + '/')
                    : repositories[path[0]]['url']
            });
            res.end();
        } else {
            let url;

            if (isGithub) {
                url = 'https://raw.githubusercontent.com/' + repositories[path[0]] + '/' + path.slice(1).join('/');
            } else {
                url = repositories[path[0]]['url'] + '/' + path.slice(1).join('/');
            }

            https.get(url, res2 => {
                let data = [];

                if (res2.statusCode != 200) {
                    if (isGithub) {
                        showDirectoryStructure(originalPath, pathOffset, res);
                    } else {
                        notFound(res, 'Page not found');
                    }
                    return;
                }

                res2.on('data', chunk => {
                    data.push(chunk);
                });

                res2.on('end', () => {
                    const suffix = path.at(-1).split('.').at(-1);

                    if (suffix in rawContentTypes) {
                        res.writeHead(200, { 'Content-Type': rawContentTypes[suffix] });
                        const content = Buffer.concat(data);
                        res.end(content);
                    } else {
                        const command = originalPath[pathOffset - 1];

                        if (command == 'cards-json') {
                            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        } else if (command == 'anki' || command == 'quizlet' || command == 'source') {
                            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
                        } else {
                            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        }

                        const content = Buffer.concat(data).toString();
                        res.end(processor(content, command, { path: originalPath, offset: pathOffset, repo: repositories[path[0]] }));
                    }
                });
            }).on('error', err => {
                notFound(res, err.message);
            });
        }
    } else {
        notFound(res, 'Repository not found');
    }
}

function pagify(markdown, command, path) {
    const titleMatch = markdown.match(/^# (.*)/);
    const fallbackTitle = path.path.at(-1).replace(/\.md$/, '');
    const title = (titleMatch && titleMatch.length == 2) ? processTitle(titleMatch[1]) : fallbackTitle;

    const renderer = new marked.Renderer();
    const markedInstance = marktex.setupMarkedInstance(marktex.options, renderer);
    const body = marktex.processKatex(markedInstance, markdown);

    return fillHtmlTemplate(placeToc(body, getHeadingList()), decorateTitle(title, path), path);
}

function cardify(markdown, command, path) {
    const beer = (typeof (path.repo) == 'object' && 'beer' in path.repo) ? path.repo.beer : 'Pokud ti moje kartičky pomohly, můžeš mi <a href="https://revolut.me/vitkolos">koupit pivo</a>.';
    let title = '';
    let description = '';
    let descriptionOpen = true;
    let currentHeading = '';
    let currentCard = null;
    const allCards = [];
    const categories = [[], []];
    const indentationMatch = markdown.match(/\n([ \t]+)/);
    const indentation = (indentationMatch && indentationMatch.length == 2) ? indentationMatch[1] : '\t';
    const listBullet = '([-*+]|[0-9]+\.) ';
    const ulRegExp = new RegExp('^[-*+] ');
    const titleCategoryRegExp = new RegExp("^\\S+: ");

    const finishCard = (currentCard, allCards) => {
        if (currentCard && currentCard.descriptionLines.length) {
            allCards.push(currentCard);
        }
    };

    markdown.split('\n').forEach(line => {
        if (line != '') {
            const ll = getListLevel(line, indentation, listBullet);

            if (line.substring(0, 2) == '# ') {
                title = processTitle(line.substring(2));
            } else if (line.substring(0, 3) == '## ') {
                finishCard(currentCard, allCards);
                currentCard = null;
                descriptionOpen = false;

                currentHeading = line.substring(3);
                categories[0].push(currentHeading);
            } else if (ll == 0) {
                finishCard(currentCard, allCards);
                descriptionOpen = false;

                currentCard = new Object();
                currentCard.title = line.substring(2);
                currentCard.categories = [null, null];
                currentCard.id = generateId(currentCard.title, allCards);
                currentCard.descriptionLines = [];

                if (currentHeading) {
                    currentCard.categories[0] = currentHeading;
                }

                if (titleCategoryRegExp.test(currentCard.title)) {
                    const catFromTitle = currentCard.title.split(':', 2)[0];
                    currentCard.categories[1] = catFromTitle;

                    if (!categories[1].includes(catFromTitle)) {
                        categories[1].push(catFromTitle);
                    }
                }
            } else if (currentCard == null) {
                if (descriptionOpen && description == '' && line != '') {
                    description = line;
                }
            } else if (ll == -1) {
                currentCard.descriptionLines.push(line);
            } else {
                currentCard.descriptionLines.push(line.substring(indentation.length));
            }
        }
    });

    finishCard(currentCard, allCards);

    if (command == 'cards-json') {
        return JSON.stringify({ title, description, categories, cards: allCards });
    } else if (command == 'anki' || command == 'quizlet') {
        const titleSep = (command == 'anki') ? '; ' : ';';
        const lineSep = (command == 'anki') ? '<br>' : '\n';
        const cardSep = (command == 'anki') ? '\n' : '\n\n';
        const separatorRemover = (command == 'anki') ? (text => text.replace(/;/g, ',')) : (text => text); // this fixes semicolons causing errors in anki

        return allCards.map(card => {
            if (card.descriptionLines.length == 1 && ulRegExp.test(card.descriptionLines[0])) {
                return separatorRemover(card.title) + titleSep + separatorRemover(card.descriptionLines[0].substring(2));
            } else {
                return separatorRemover(card.title) + titleSep + separatorRemover(card.descriptionLines.join(lineSep));
            }
        }).join(cardSep);
    } else {
        const staticRoute = '/' + path.path.slice(0, path.offset - 1).join('/') + '/static';
        let body = `
            <h1>${title}</h1>
            <div class="htbutton">
                <span>${title}</span><button type="button" onclick="hideTop(false);">zobrazit záhlaví</button>
            </div>
            <div class="top">
                <div class="learn">
                    <button type="button" onclick="startRun(-1);">nové</button>
                    <button type="button" onclick="startRun(1);">≤ 1</button>
                    <button type="button" onclick="startRun(2);">≤ 2</button>
                    <button type="button" onclick="startRun(3);">≤ 3</button>
                    <button type="button" onclick="startRun(4);">všechny</button>
                    <span class="filtersactive-wrapper" ${(categories[0].length || categories[1].length) ? '' : 'style="display:none"'}>
                        <input type="checkbox" id="filtersactive" onclick="toggleFilters();" /><label for="filtersactive">filtrovat</label>
                    </span>
                </div>
                <div class="filters" id="filters">
                    ${categories.map((group, gIndex) => `<div>${group.map((category, cIndex) =>
            `<span><input type="checkbox" id="filter-${gIndex}-${cIndex}" onclick="toggleFilter(${gIndex}, '${category}', this);" data-title="${category}" />
                        <label for="filter-${gIndex}-${cIndex}">${category}</label></span>`
        ).join('')}</div>`).join('')}
                </div>
                <div class="options">
                    <button type="button" onclick="resetPrompt();">reset</button>
                    <button type="button" onclick="exportData();" id="exportbtn">export</button>
                    <button type="button" onclick="importData();">import</button>
                    <button type="button" onclick="hideTop(true);">skrýt záhlaví</button>
                </div>
            </div>
            <code id="exporthere"></code>
            <div id="stats" class="stats"></div>
        `;

        const markedInstance = marktex.setupMarkedInstance(marktex.options);
        allCards.forEach(card => {
            const desc = (card.descriptionLines.length == 1 && ulRegExp.test(card.descriptionLines[0]))
                ? card.descriptionLines[0].substring(2) : card.descriptionLines.join('\n');
            body += `
                <div id="${card.id}" class="card">
                    <div class="title" onclick="flip();">
                        <div class="categories">${card.categories[0] ? card.categories[0] : ''}</div>
                        ${marktex.processKatex(markedInstance, card.title)}
                    </div>
                    <div class="description">${marktex.processKatex(markedInstance, desc)}</div>
                </div>
            `;
        });

        body += `
            <div id="welldone" class="welldone">Hurá, máš hotovo! 🎉 <br>${beer}</div>
            <div class="flipper" onclick="flip();"></div>
            <div id="controls" class="controls">
                <div class="ctop">
                    <button type="button" class="flip" onclick="flip();">rozbalit</button>
                    <button type="button" class="previous" onclick="previous();">předchozí</button>
                    <button type="button" class="next" onclick="next();">další</button>
                    <button id="progress" class="progress" tabindex="-1"></buttons>
                </div>
                <div class="cbottom">
                    <button type="button" class="mark" onclick="mark(1);">1 neumím</button>
                    <button type="button" class="mark" onclick="mark(2);">2 umím trochu</button>
                    <button type="button" class="mark" onclick="mark(3);">3 umím středně</button>
                    <button type="button" class="mark" onclick="mark(4);">4 umím výborně</button>
                </div>
            </div>
            <script>
                var cardIds = ['${allCards.map(card => card.id).join('\', \'')}'];
                var cardCategories = {${allCards.map(card => `'${card.id}': ['${card.categories.join('\', \'')}'], `).join('')}};
            </script>
            <script src="${staticRoute}/cards.js"></script>
        `;
        const head = `<link rel="stylesheet" href="${staticRoute}/cards.css">`;
        return fillHtmlTemplate(body, decorateTitle(title, path, true), path, head);
    }
}

function processTitle(title) {
    return title.replaceAll('\\', '');
}

function decorateTitle(title, path, cards = false) {
    if (cards) {
        title += ': kartičky';
    }

    const nonDirectoryItemsLength = 2; // repo + branch

    if ((path.path.length - path.offset - nonDirectoryItemsLength) >= 2) {
        return title + ' | ' + path.path.at(-2);
    }

    return title;
}

function getListLevel(line, indentation, listBullet) {
    const gllMatch = line.match(new RegExp('^((' + indentation + ')*)' + listBullet));

    if (gllMatch == null || indentation == '') {
        return -1;
    } else {
        return gllMatch[1].length / indentation.length;
    }
}

function slugify(string) {
    string = replaceAll(string.toLowerCase(), 'říšžťčýůňúěďáéóě', 'risztcyunuedaeoe');
    return string.replace(/\W/g, ' ').trim().replace(/\s+/g, '-');
}

function generateId(string, cards) {
    const slug = slugify(string);
    let id = slug.substring(0, 20) + '~' + slug.slice(-9);

    while (cards.some(card => card.id == id)) {
        id += '*';
    }

    return id;
}

function replaceAll(str, arr1, arr2) {
    var re = new RegExp(arr1.split('').join('|'), 'gi');

    return str.replace(re, function (matched) {
        return arr2[arr1.indexOf(matched)];
    });
}

function placeToc(pageHtml, toc) {
    toc.shift(); // remove first h1

    if (toc.length < 3) {
        return pageHtml;
    }

    const tocHtml = `<div class="toc">${toc.map(h => `<a href="#${h.id}" class="toc-h${h.level}">${h.text}</a>`).join('')}</div>`;
    return pageHtml.replace('</h1>', '</h1>' + tocHtml);
}

function fillHtmlTemplate(body, title, path, head = '') {
    const links = ['view', 'cards', 'source'].map(link => {
        const currentClass = link == path.path[path.offset - 1] ? ' class="current"' : '';
        return '<a href="/' + path.path.slice(0, path.offset - 1).join('/') + '/' + link + '/' + path.path.slice(path.offset).join('/') + '"' + currentClass + '>' + link + '</a>';
    });
    const ghUrl = typeof (path.repo) == 'string' ? 'https://github.com/' + path.repo + '/blob/' + path.path.slice(path.offset + 1).join('/') : null;
    const staticRoute = '/' + path.path.slice(0, path.offset - 1).join('/') + '/static';

    const matomo = `<!-- Matomo -->
    <script>
        var _paq = window._paq = window._paq || [];
        _paq.push(['disableCookies']);
        _paq.push(['trackPageView']);
        _paq.push(['enableLinkTracking']);
        (function() {
            var u = "//www.vitkolos.cz/matomo/";
            _paq.push(['setTrackerUrl', u + 'matomo.php']);
            _paq.push(['setSiteId', '1']);
            var d = document,
                g = d.createElement('script'),
                s = d.getElementsByTagName('script')[0];
            g.async = true;
            g.src = u + 'matomo.js';
            s.parentNode.insertBefore(g, s);
        })();
    </script>
    <!-- End Matomo Code -->`;

    return `<!DOCTYPE html>
<html lang="cs">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.4/dist/katex.min.css" integrity="sha384-vKruj+a13U8yHIkAyGgK1J3ArTLzrFGBbBc0tDp4ad/EyewESeXE/Iv67Aj8gKZ0" crossorigin="anonymous">
    <link rel="stylesheet" href="${staticRoute}/style.css">
    <script src="${staticRoute}/theme.js"></script>
    ${matomo}
    ${head}
</head>
<body>
<small class="top-nav"><a href=".">this dir</a> | ${links.join(' | ')} | ${ghUrl ? `<a href="${ghUrl}">edit</a> | ` : ''}<a href="#" id="theme-toggle">dark</a></small>
<small class="bottom-nav"><a href="#">top</a></small>
${body}
</body>
</html>
`;
}

function showDirectoryStructure(originalPath, pathOffset, res) {
    const repositorySlug = originalPath[pathOffset];
    const branch = originalPath[pathOffset + 1];
    const pathInRepo = originalPath.slice(pathOffset + 2).join('/');
    const apiUrl = 'https://vitkolos:' + process.env.GH_TOKEN + '@api.github.com/repos/' + repositories[repositorySlug] + '/contents/' + pathInRepo + '?ref=' + branch;

    https.get(apiUrl, { headers: { 'User-Agent': 'vitkolos' } }, res2 => {
        let data = [];

        if (res2.statusCode != 200) {
            notFound(res, 'Page does not exist');
            return;
        }

        res2.on('data', chunk => {
            data.push(chunk);
        });

        res2.on('end', () => {
            const content = Buffer.concat(data).toString();
            const items = JSON.parse(content);
            let reversePath = originalPath.slice(pathOffset + 2);
            reversePath.reverse();
            reversePath.push(repositorySlug);
            const title = decodeURIComponent(reversePath.join(' | '));
            const doubleDotAddress = pathInRepo.length ? ('/' + originalPath.slice(0, -1).join('/') + '/') : '/';
            let body = '<ul class="index">';
            body += `<li><a href="${doubleDotAddress}" class="dir">..</a></li>`;

            items.forEach(item => {
                if (!item.name.startsWith('.')) {
                    let currentPath = '/' + originalPath.slice(0, pathOffset + 2).join('/') + '/' + item.path + (item.type == 'dir' ? '/' : '');
                    body += `<li><a href="${currentPath}" class="${item.type}">${item.name}</a></li>`;
                }
            });

            body += '</ul>';
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(fillHtmlTemplate(body, title, { path: originalPath, offset: pathOffset, repo: repositories[repositorySlug] }));
        });
    }).on('error', err => {
        notFound(res, err.message);
    });
}

module.exports = {
    getView, getCards, getSource
};
