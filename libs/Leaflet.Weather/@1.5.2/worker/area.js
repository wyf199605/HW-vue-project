function getArea(libPrefix,lineData,mask,legendData){
    importScripts('./ThirdParty/turf@4.7.3.min.js');

    var geojson = getMultiPolygon(mask);
    lineData.forEach(function (item) {
        var coords = item.pointitems.map(function (c) {
            return [c[1],c[0]];
        });
        coords.push(coords[0]);
        var poly = turf.polygon([coords]);
        var intersect = turf.intersect(geojson,poly);
        item._area = intersect.geometry ? turf.area(intersect) : 0;
    });
    lineData.forEach(function (item) {
        var subArea = 0;
        if (item.cid) {
            item.cid.forEach(function (id) {
                subArea += lineData[id]._area;
            })
        }
        item.area = item._area-subArea;

        var idx = getColorIndex(legendData,item.tinterValue);
        if(idx !== -1){
            var legendItem = legendData[idx];
            legendItem.area = legendItem.area || 0;
            legendItem.area += item.area;
        }
    });

    return legendData;
}

function getMultiPolygon(geojson){
    var polys =[];
    var geometry = geojson.features[0].geometry;
    if(geometry.type === 'Polygon')
        polys.push(geometry.coordinates);
    else if(geometry.type === 'MultiPolygon'){
        polys.push(geometry.coordinates[0]);
    }
    return turf.multiPolygon(polys);
}

function getColorIndex(legendData, value){
    for (var i = 0; i < legendData.length; i++) {
        var item = legendData[i];
        if (isNaN(item.min) || item.min == null) {
            if (value < item.max || (item.equalMax && value == item.max))
                return i;
        }
        else if (isNaN(item.max) || item.max == null) {
            if (value > item.min || (item.equalMin && value == item.min))
                return i;
        }
        else {
            if ((value > item.min && value < item.max) || (item.equalMax && value == item.max) || (item.equalMin && value == item.min))
                return i;
        }
    }
    return -1;
}

self.onmessage = function (a) {
    postMessage(getArea(a.data.libPrefix,a.data.lineData,a.data.mask,a.data.legendData))
};
