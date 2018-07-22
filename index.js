// ==============================================
// Randy POC
// built by : Gideon Simons, 2018
// ==============================================

//dependencies
var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var bodyParser = require('body-parser');
var playlist = require('./lib/playlist_utils.js');
var createPlayer = require('./lib/mpv-wrapper');
var metaget = require("metaget");
var cp = require('child_process');
var WatchJS = require("melanke-watchjs");

//vars
var player = null;
var psocket = null;
var port = process.env.PORT || 8888;
var isloaded = false;
var watch = WatchJS.watch;
var seekable = true;

//express parsing support
app.use(bodyParser.json()); // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({
    extended: true
})); // to support URL-encoded bodies

///--- APIs Exposed ---///

//POST 
app.post('/getStickyList', function (req, res) {
    res.header("Access-Control-Allow-Origin", "http://localhost");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    //return
    res.json({"results":playlist.getStickyList(req.body.limit)});
});

app.post('/getAlbums', function (req, res) {
    res.header("Access-Control-Allow-Origin", "http://localhost");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    //return
    res.json({"results":playlist.getAlbums(req.body.limit)});
});

app.post('/getRandomAlbums', function (req, res) {
    res.header("Access-Control-Allow-Origin", "http://localhost");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    //return
    res.json({"results":playlist.getRandomAlbums(req.body.limit)});
});

app.post('/searchSongs', function (req, res) {
    res.header("Access-Control-Allow-Origin", "http://localhost");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    //return
    console.log("searching with keyword: " + req.body.keyword);
    res.json({"results":playlist.searchSongs(req.body.keyword)});
});

app.post('/getURLMeta', function (req, res) {
    res.header("Access-Control-Allow-Origin", "http://localhost");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    metaget.fetch(req.body.url, function (err, meta_response) {
        if(err){
            console.log("url metadata error: " + err);
            res.json({"success":false,"err":err,"results":null});
        }else{
            console.log(meta_response);
            //return
            res.json({"success":true,
                      "title":meta_response['og:title'],
                      "description":meta_response['og:description'],
                      "img":meta_response["og:image"]});
        }
    });
    
});

//IO
io.on('connection', function(socket){
    
    psocket = socket;
    
    console.log('a user connected');
    
    if (playlist.getPlayList().length > 0){
    psocket.emit('playlist', {playlist:playlist.getPlayList(), playing:playlist.getPlaying()});
    var curs = playlist.getCurrentSong();
    psocket.emit('nowplaying', {title:curs.tags.common.title, albumart:curs.albumart});
    }
    
    socket.on('play', function(msg){
      console.log('play');
      player.play();
    });

    socket.on('pause', function(msg){
      console.log('pause');
      player.pause();
    });

    socket.on('next', function(msg){
      console.log('next');
      playsong(playlist.nextsong());
    });

    socket.on('prev', function(msg){
      console.log('prev');
      playsong(playlist.prevsong());
    });
    
    socket.on('playsong', function(msg){
      console.log('playsong');
      playsong(playlist.playsong(msg));
    });
    
    socket.on('seek', function(msg){
      console.log('seek');
      player.seek(msg, 'absolute');
    });
    
    socket.on('playnow', function(msg){
      console.log('playnow');
      //check for albums
      if (Array.isArray(msg)){
          for (i = 0; i < msg.length; i++){
              playlist.addandplay(msg[i]).then(function(p){
                  if (i == 0){
                    playsong(p);
                  }
              });
          }
      } else {
          playlist.addandplay(msg).then(function(p){
              playsong(p);
          });
      }
    });
    
    socket.on('addtolist', function(msg){
      console.log('addtolist');
        if (Array.isArray(msg)){
          for (i = 0; i < msg.length; i++){
              playlist.addlast(msg[i]);
          }
      } else {
          playlist.addlast(msg);
      }
    });
    
    socket.on('stick', function(msg){
      console.log('stick');
      playlist.addtosticky(msg);
    });
    
});

///--- Public web ui folder ---///
app.use("/", express.static(__dirname + "/public"));

//start server//
http.listen(port, function(){
  console.log("Randy on port " + port);
});

console.log("Welcome to Randy - localhost:8888");

////--- init the player ---////

killmpv();

createPlayer({ args: ['--no-video'] }, (err, newplayer) => {
    if (err) {
        console.error("Error creating player - " + err);
    } else {
        console.log("New mpv player started on Idle");
        player = newplayer;
        //load the current song
        if (playlist.getPlayList().length > 0){
            playsong(playlist.getCurrentSong());
        }
        //listen to events
        player.observeProperty('audio-pts', function(t){
            io.sockets.emit('pos', t);
        });
        player.observeProperty('seekable', function(t){ 
            //console.log('seekable: ' + t);
            seekable = t;
        });
        player.observeProperty('duration', function(t){
            if (seekable){
                io.sockets.emit('duration', t);
            }
        });
        //player.observeProperty('audio-params', t => console.log('audio-params: ' + JSON.stringify(t)));
        player.observeProperty('media-title', function(t){
            if (t == null && !isloaded){
                playsong(playlist.nextsong());
            }
            var curs = playlist.getCurrentSong();
            console.log('Title changed: ' + t);
            io.sockets.emit('nowplaying', {title:t,albumart:curs.albumart});
        });
        
        player.observeProperty('metadata', function(t){
            //console.log('metadata: ' + JSON.stringify(t));
            if (t !== null){
                if (t.hasOwnProperty("icy-title")){
                    console.log('Title changed: ' + t["icy-title"]);
                    var curs = playlist.getCurrentSong();
                    var al = curs.tags.common.artist;
                    if (t.hasOwnProperty("icy-name")){
                        al += " - " + t["icy-name"];
                    } else {
                        al += " - " + curs.tags.common.title;
                    }
                    io.sockets.emit('nowplaying', {title:t["icy-title"], album:al , albumart:curs.albumart});
                }
            }
        });
        
        //player.observeProperty('AV', t => console.log('Audio specs: ' + t));
        //player.observeProperty('A', t => console.log('Player info: ' + t));
        //when mpv is idle
        player.onIdle(() => {
            console.error('idle');
        });
        //finished playing a file
        player.onEndFile(() => {
            console.log('end of file');
            if (!isloaded){
                console.log('real end of file - playing next');
                playsong(playlist.nextsong());
            }
            isloaded = false;
        });
        
        //watch the playlist
        watch(playlist.getPlayList(), function(){
            io.sockets.emit('playlist', {playlist:playlist.getPlayList(), playing:playlist.getPlaying()});
        });
    }	
});     

process.on('SIGINT', function() {
    killmpv();
    process.exit(0);
});

function killmpv(){
    cp.spawnSync('killall',['mpv']);
}


//load playlist
playlist.getAllSongs().then(function(){
    playlist.initPlaylist(3).then(function(fsong){
        if (player != null){
            console.log("loading first song - " + fsong.songfile);
            playsong(fsong); 
        }
    });
});

function playsong(songobj){
    if (songobj){
        isloaded = true;
        player.loadfile(songobj.songfile, 'replace');
        io.sockets.emit('playlist', {playlist:playlist.getPlayList(), playing:playlist.getPlaying()});
    } else {
        console.log("bad songobj + " + JSON.stringify(songobj));
    }
}