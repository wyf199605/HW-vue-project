importScripts('./shp.min.js');

onmessage = function (e) {
    let url = e.data;
    shp(url).then(function (data) {
        postMessage(data);
    });
};
