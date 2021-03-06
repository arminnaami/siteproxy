var express = require('express')
const zlib = require("zlib")
const fs = require("fs")
const queryString = require('query-string')
const parse = require('url-parse')

const cookiejar = require('cookiejar')
const {CookieAccessInfo, CookieJar, Cookie} = cookiejar

let config = {
    httpprefix: 'https', port: 443,
    serverName: 'siteproxy.now.sh',
}
if (process.env.herokuAddr) {
    config.serverName = process.env.herokuAddr
}
console.log(`config.serverName:${config.serverName}`)
if (process.env.localFlag === 'true') {
    config.httpprefix = 'http'
    config.port = '8011'
    process.env.PORT = config.port
    config.serverName = '127.0.0.1'
}

let {httpprefix, serverName, port, accessCode} = config

const urlModify = ({httpType, host, url}) => {
    // this url is actually a partial url, without https://${host}:${port}
    let newpath = url.replace(`/${httpType}/${host}`, '') || '/'
    var parsed = parse(newpath)
    const parsedQuery = queryString.parse(parsed.query)
    if (host.indexOf('googlevideo.com') !== -1) {
        console.log(`mime = ${parsedQuery['mime']}`)
        if (parsedQuery['mime'] === 'audio/mp4') {
            // parsedQuery['mime'] = 'audio%2Fwebm'
        }
    }
    parsed.set('query', queryString.stringify(parsedQuery))
    // console.log(`after change: ${parsed.href}`)
    return parsed.href
}

const locationReplaceMap302 = ({location, serverName, httpprefix, host, httpType}) => {
    let myRe
    if (!location) {
        return '/'
    }
    if (location.startsWith('https://')) {
        myRe = new RegExp('https://([-a-z0-9A-Z.]+)', 'g')
        location = location.replace(myRe, `${httpprefix}://${serverName}:${port}/https/$1`)
    } else
    if (location.startsWith('http://')) {
        myRe = new RegExp('http://([-a-z0-9A-Z.]+)', 'g')
        location = location.replace(myRe, `${httpprefix}://${serverName}:${port}/http/$1`)
    } else
    if (location.startsWith('/') && location.indexOf(`/${httpType}/${host}`) === -1) {
        location = `/${httpType}/${host}${location}`
    }
    myRe = new RegExp(`/${httpprefix}/${serverName}:${port}`, 'g') // match group
    location = location.replace(myRe, '')
    return location
}

const regReplaceMap = {
    '"//([-a-z0-9A-Z.]+)': `"//${serverName}:${port}/https/$1`, // default use https
    '\'//([-a-z0-9A-Z.]+)': `'//${serverName}:${port}/https/$1`,// default use https
    'url[(]//([-a-z0-9A-Z.]+)': `url(//${serverName}:${port}/https/$1`,// default use https
    'https:(././)([-a-z0-9A-Z.]+)': `${httpprefix}:$1${serverName}:${port}\\/https\\/$2`,
    'http:(././)([-a-z0-9A-Z.]+)': `${httpprefix}:$1${serverName}:${port}\\/http\\/$2`,
    'https://([-a-z0-9A-Z.]+)': `${httpprefix}://${serverName}:${port}/https/$1`,
    'http://([-a-z0-9A-Z.]+)': `${httpprefix}://${serverName}:${port}/http/$1`,
    'https%3a%2f%2f([-a-z0-9A-Z]+?)': `${httpprefix}%3a%2f%2f${serverName}%3a${port}%2fhttps%2f$1`,
    'http%3a%2f%2f([-a-z0-9A-Z]+?)': `${httpprefix}%3a%2f%2f${serverName}%3a${port}%2fhttp%2f$1`,
    'https%3A%2F%2F([-a-z0-9A-Z]+?)': `${httpprefix}%3A%2F%2F${serverName}%3A${port}%2Fhttps%2F$1`,
    'http%3A%2F%2F([-a-z0-9A-Z]+?)': `${httpprefix}%3A%2F%2F${serverName}%3A${port}%2Fhttp%2F$1`,
    ' integrity=".+?"': '', // remove integrity
}

const pathReplace = ({host, httpType, body}) => {
    // href="//127.0.0.1:8011/https/n
    let myRe = new RegExp(`href=([\"\']?)/([-a-z0-9_]+?)`, 'g')
    body = body.replace(myRe, `href=$1/${httpType}/${host}/$2`)

    myRe = new RegExp(`href="/"`, 'g')
    body = body.replace(myRe, `href="/${httpType}/${host}/"`)

    myRe = new RegExp(` src=([\"\']?)/([-a-z0-9_]+?)`, 'g')
    body = body.replace(myRe, ` src=$1/${httpType}/${host}/$2`)

    myRe = new RegExp(` src="/"`, 'g')
    body = body.replace(myRe, ` src="/${httpType}/${host}/"`)
    /*
    myRe = new RegExp(' src=(["\'])//([-a-z0-9]+?)', 'g')
    body = body.replace(myRe, ` src=$1//${serverName}:${port}/${httpType}/${host}/$2`)
    */

    myRe = new RegExp('([:, ]url[(]["\']?)/([-a-z0-9]+?)', 'g')
    body = body.replace(myRe, `$1/${httpType}/${host}/$2`)

    myRe = new RegExp('("url":[ ]?")/([-a-z0-9_]+?)', 'g')
    body = body.replace(myRe, `$1/${httpType}/${host}/$2`)

    myRe = new RegExp('(url:[ ]?")/([-a-z0-9_]+?)', 'g')
    body = body.replace(myRe, `$1/${httpType}/${host}/$2`)

    myRe = new RegExp('(rl.":.")./([-a-z0-9_]+?)', 'g')
    body = body.replace(myRe, `$1\\/${httpType}\\/${host}\\/$2`)

    myRe = new RegExp('("path":")/([-a-z0-9_]+?)', 'g')
    body = body.replace(myRe, `$1/${httpType}/${host}/$2`)

    myRe = new RegExp(' action="/([-a-z0-9A-Z]+?)', 'g')
    body = body.replace(myRe, ` action="/${httpType}/${host}/$1`)

    return body
}

const siteSpecificReplace = {
    'www.google.com': {
        '(s=.)/images/': `$1/https/www.google.com/images/`,
        '(/xjs/_)':`/https/www.google.com$1`,
        'srcset="/images/branding/googlelogo': `srcset="/https/www.google.com/images/branding/googlelogo`,
   //      '/search\?"': `/https/www.google.com/search?"`,
        '"(/gen_204\?)': `"/https/www.google.com$1`,
        '"(www.gstatic.com)"': `"${serverName}:${port}/https/$1"`,
        'J+"://"': `J+"://${serverName}:${port}/https/"`,
        'continue=.+?"': 'continue="', // fix the gmail login issue.
        's_mda=/.https:(././).+?/http/': `s_mda=/^http:$1`, // recover Ybs regular expression
        'href="/https/www.google.com/g(.;)': 'href="/g$1',
        '[\(]"/url': `\("/https/www.google.com/url`, //s_Gj("/url?sa=t&source=web&rct=j");s_Nj
        '"/url"': `"/https/www.google.com/url"`,
    },
    'www.gstatic.com': {
        'href="/https/www.gstatic.com/g(.;)': 'href="/g$1',
    },
    'accounts.google.com': {
        'Yba=/.+?/http/': `Yba=/^http:\\/\\/`, // recover Ybs regular expression
        'continue%3Dhttps.+?ManageAccount': 'continue%3D', // fix the gmail login issue.
        '"signin/v2': '"https/accounts.google.com/signin/v2',
        'quot;https://[:-a-z0-9A-Z.]+?/https/accounts.google.com/ManageAccount': `quot;`,
    },
    'youtube.com': {
        'b."get_video_info"': `"${httpprefix}://${serverName}:${port}/https/www.youtube.com/get_video_info"`,
        'c<a.C.length': `c<a.C.length&&a.C[c].style`, // fixed the exception.
        // ' .......*?"Captions URL".': ' true', // Ms(Os(a, jfa, null), a, b, "Captions URL") // time costy
        'throw Error."Untrusted URL.+?;': ';',
        '"//"(.this\..\...\...."/api/stats/qoe")': `"//${serverName}:${port}/https/"$1`, //;b=g.$g("//"+this.o.ab.Ff+"/api/stats/qoe",a);
        'return .\.protocol."://(i1.ytimg.com/vi/)"': `return "${httpprefix}://${serverName}:${port}/https/$1"`, // {return a.protocol+"://i1.ytimg.com/vi/"+b+"/"+(c||"hqdefault.jpg")};
        '(rl%22%3A%22%2F%2F)([-a-z0-9A-Z.]+?)': `$1${serverName}%3A${port}%2Fhttps%2F$2`, // rl%22%3A%22%2F%2Fwww.youtube.com
        '(.\..."ptracking",)': `"${httpprefix}://${serverName}:${port}/https/www.youtube.com/ptracking",`,//(d.C+"ptracking",    in base.js
        ':"//"[+].\...[+]"/api/stats/"': `:"//${serverName}:${port}/https/www.youtube.com/api/stats/"`, // his.sa=this.O?"/api/stats/"+c:"//"+b.If+"/api/stats/"+c;d&&(t
        'iconChanged_:function.[a-z],[a-z],[a-z]...*\},': `iconChanged_:function(a,b,c){},`, // iconChanged_:function(a,b,c){
        '"/youtubei': `"/https/www.youtube.com/youtubei`,
        '"/api/stats/"': `"/https/www.youtube.com/api/stats/"`,
        '"/service_ajax"': `"/https/www.youtube.com/service_ajax"`,
        // '(this\..\.logo\.hidden.*?[,;])': ``,
        // '(&&this\..\.content\.insertBefore.*?;)': `;`, //  && this.$.content.insertBefore(this.$.guide, this.$["page-manager"]);
        '[&]{2}this\.connectedCallback[(][)][)]:': `):`, // &&this.connectedCallback()):
        '="/sw.js"': `="/https/www.youtube.com/sw.js"`,
    },
    'search.yahoo.com': {
        '"./ra./click"': `"\\/https\\/search.yahoo.com\\/ra\\/click"`,
        '(["\']).?/beacon': `$1${serverName}:${port}\\/https\\/search.yahoo.com\\/beacon`,
    },
    'wikipedia.org': {
    },
    'wikimedia.org': {
    },
    'twitter.com': {
        '"/settings"': '"/https/twitter.com/settings"',
        '"/signup"': '"/https/twitter.com/signup"',
        '"/login/error"': '"/https/twitter.com/login/error"',
        '"/i/flow/signup"': '"/https/twitter.com/i/flow/signup"',
        '"/i/sms_login"': '"/https/twitter.com/i/sms_login"',
        '"/login/check"': '"/https/twitter.com/login/check"',
        '"/login"': '"/https/twitter.com/login"',
    },
    'web.telegram.org': {
        '"pluto"': `"${serverName}:${port}/https/pluto"`,
        '"venus"': `"${serverName}:${port}/https/venus"`,
        '"aurora"': `"${serverName}:${port}/https/aurora"`,
        '"vesta"': `"${serverName}:${port}/https/vesta"`,
        '"flora"': `"${serverName}:${port}/https/flora"`,
    },
    'zh-cn.facebook.com': {
        '"/ajax/bz"': `"/https/zh-cn.facebook.com/ajax/bz"`,
    },
    'static.xx.fbcdn.net': {
        '"/ajax/bz"': `"/https/zh-cn.facebook.com/ajax/bz"`,
        '"/intern/common/': '"/https/static.xx.fbcdn.net/intern/common/',
    },
    'www.mitbbs.com': {
        'src="img/': `src="/https/www.mitbbs.com/img/`,
        'alt="img/': `alt="/https/www.mitbbs.com/img/`,
        'src="[.]/img/': `src="/https/www.mitbbs.com/img/`,
        'src="[.]{2}/img/': `src="/https/www.mitbbs.com/img/`,
    }
}

module.exports = { urlModify, httpprefix, serverName, port, locationReplaceMap302, regReplaceMap, siteSpecificReplace, pathReplace }
