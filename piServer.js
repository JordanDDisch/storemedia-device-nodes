require('dotenv').config()

var app = require('express')();
var http = require('http').Server(app);
var osutils = require('os-utils');
var sio = require('socket.io')(http);
var ip = require("ip");
let platform = osutils.platform();
let cores = osutils.cpuCount();
let uptime = (osutils.sysUptime() / 1000) / 60;
let myip = ip.address();
var fs = require('fs');
var md5 = require('md5');
var piTemp = require('pi-temperature');
var execute = require('child_process');
var si = require('systeminformation');

var devMode = process.env.NODE_ENV === 'development' ? true : false;
var sysvars = {
    deviceIdFile: '/home/pi/storemedia-device-nodes/deviceID.txt',
    port: 3050,
    assetScheduleTimer: '300000', // 5 minutes
    healthCheckTimer: 10000, // 10 seconds
    healthCheckHandle: null
};
if (devMode) {
    sysvars.port = 3050;
    sysvars.assetScheduleTimer = '300000'; // 5 minutes
}

var deviceDetails = {
    id: '',
    location: '',
    placement: '',
    landscape: '',
    socketid: ''
};

//create a better uuid for the machine

fs.stat(sysvars.deviceIdFile, function (err, stat) {
    if (err == null) {
        console.log('File exists');
        fs.readFile('deviceID.txt', 'utf8', function (err, data) {
            if (err) throw err;
            console.log("This device ID is " + data);
            deviceDetails.id = data;
        });
    } else if (err.code == 'ENOENT') {
        // file does not exist
        console.log('device ID does not exist - creating now');
        var tstamp = new Date().getTime();
        console.log(tstamp);
        var multi = myip.replace(/\./g, '');
        console.log(multi);
        var myIDnoHash = (tstamp + multi);
        console.log(myIDnoHash);
        var deviceId = md5(myIDnoHash);
        console.log(deviceId);
        fs.writeFile(sysvars.deviceIdFile, deviceId, function (err) {
            if (err) throw err;
            console.log('Created Device ID!');
            deviceDetails.id = deviceId;
        });
    } else {
        console.log('Some other error: ', err.code);
    }
});


var io = require("socket.io-client");

var ioClient = io.connect("http://storemedia.local:8082"); //development

ioClient.on("seq-num", (msg) => console.info(msg));

ioClient.on("conn-recd", (msg) => console.info(msg));

ioClient.on("AssetList", (msg) => console.info(msg));

ioClient.on('reloadAssets', function (msg) {
    console.log('piServer reloading assets');
    sio.emit('reloadAssets');
});

ioClient.on('refreshBrowser', function (msg) {
    console.log('piServer reloading browser');
    sio.emit('reloadBrowser');
});

ioClient.on('getInitial', function () {
    console.log('sending initial response: location:' + deviceDetails.location + 'placement: ' + deviceDetails.placement)
    reporter()
})

ioClient.on('changeOrientation', function (msg) {
    console.log('piServer changeOrientation');
    sio.emit('reloadDevice');
});

ioClient.on('startReporter', startReporter)

ioClient.on('turnDisplayOff', function () {
    child = execute.stdin.write("echo 'standby 0' | cec-client -s -d 1")
})

ioClient.on('turnDisplayOn', function () {
    child = execute.stdin.write("echo 'on 0' | cec-client -s -d 1")
})

ioClient.on('restartDevice', function () {
    child = execute.stdin.exec("sudo reboot")
})

ioClient.on('gitPull', function (msg) {
    console.log('Do a git pull', function (error, stdout, stderr) {
        console.log('stdout: ' + stdout);
        console.log('stderr: ' + stderr);
        if (error !== null) {
            console.log('exec error: ' + error);
        }
    });

    var child = execute.exec('sudo -H -u pi git pull origin react && sudo -H -u pi npm install && sudo pm2 restart piServer',
        function (error, stdout, stderr) {
            console.log('stdout: ' + stdout);
            console.log('stderr: ' + stderr);
            if (error !== null) {
                console.log('exec error: ' + error);
            }
        });
});

ioClient.on('stopReporter', function () {
    stopReporting()
})

app.get('/', function (req, res) {
    res.sendFile(__dirname + '/index.html');
});

var tempy = {};

function reporter() {

    console.log("Device UUID: " + deviceDetails.id + " | " + "IP: " + myip + " | " + "CPU cores: " + cores + " | " + "Platform: " + platform + " | " + "Uptime: " + uptime + " | test git");
    
    execute.exec("echo 'pow 0.0.0.0' | cec-client -s -d 1 | grep power && tvservice -s", function (error, stdout, stderr) {
        console.log('TV Power Status: ' + stdout);

        let lines = stdout.toString().split('\n');

        let TVOn = false;
        let HDMIOn = false;

        if(lines[0] && lines[0].includes('power status: on')) {
            TVOn = true;
        }

        if(lines[1] && lines[1].includes('0xa')) {
            HDMIOn = true;
        }

        if (error !== null) {
            console.log('exec error: ' + error);
        }

        piTemp.measure(function (err, piTemp) {
            if (err) console.error(err);
            else console.log("piTemp =  " + piTemp + " celsius.");
            tempy = piTemp;
        })
    
        ioClient.emit('statMon', {
            "devid": deviceDetails.id,
            "temp": JSON.stringify(tempy),
            "uptime": uptime,
            "ip": myip,
            "scktid": ioClient.id,
            "loc": deviceDetails.location,
            "pl": deviceDetails.placement,
            "landscape": deviceDetails.landscape,
            "HDMIOn": HDMIOn,
            "TVOn": TVOn
        });
    })
}

function startReporter() {
    console.log('starting reporting');
    if (sysvars.healthCheckHandle === null) {
        sysvars.healthCheckHandle = setInterval(reporter, sysvars.healthCheckTimer);
    }
}

function stopReporting() {
    console.log('stop reporting');
    if (sysvars.healthCheckHandle !== null) {
        clearInterval(sysvars.healthCheckHandle)
        sysvars.healthCheckHandle = null
    }
}

http.listen(sysvars.port, function () {
    console.log('listening on *:' + sysvars.port);
    console.log("Device UUID: " + deviceDetails.id + " | " + "IP: " + myip + " | " + "CPU cores: " + cores + " | " + "Platform: " + platform + " | " + "Uptime: " + uptime + " |");
});

sio.on('connection', function (socket) {
    console.log('conn recd');

    socket.emit('connectMe1', {
        "devid": deviceDetails.id,
        "ip": myip,
        "scktid": socket.id
    });

    socket.on('reportOnce', function (msg) {
        console.log('report once: ' + 'location: ' + msg.location + 'placement: ' + msg.placement)
        deviceDetails.location = msg.location
        deviceDetails.placement = msg.placement
        reporter()
    })
});

// Start timers to notify browser to check asset dates
setTimeout(checkDates, sysvars.assetScheduleTimer);

// Do we have a way of checking to see if there are any assets to check??
function checkDates() {
    console.log('Notify client to check dates');
    sio.emit('checkDates');
    setTimeout(checkDates, sysvars.assetScheduleTimer);
}
