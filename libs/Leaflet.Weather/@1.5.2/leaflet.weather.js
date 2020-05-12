/**
 *
 * Leaflet.Weather
 * 基于leaflet1.0.2的气象gis库类
 * 需匹配使用sun.js@1.0.8或以上,部分功能需要更高版本的sun.js
 */
LW = L.Weather = {
    // version: '1.4.8',
    version: '1.5.2',

    /**
     * Update Note：
     *      + v1.4.7 ：增加workerPath和workerLibPath来配置存放worker和worker需要用到的库的跟地址
     */
    workerPath:'./worker/',

    /**
     * Update Note：
     *      + v1.5.0 ：增加icon图片地址的跟地址，并修改有引用图片的位置改为直接用这个跟地址
     */
    defaultIconPath:function () {
        var el = L.DomUtil.create('div',  'lw-default-icon-path', document.body);
        var path = L.DomUtil.getStyle(el, 'background-image') ||
            L.DomUtil.getStyle(el, 'backgroundImage');	// IE8

        document.body.removeChild(el);

        return path.indexOf('url') === 0 ?
            path.replace(/^url\([\"\']?/, '').replace(/marker\.png[\"\']?\)$/, '') : '';
    }
};

L.Map.addInitHook(function () {
    this.createPane('boundaryPane');
    this.createPane('gridPane');
    this.createPane('typPane');
});

function expose() {
    var oldLW = window.LW;

    LW.noConflict = function () {
        window.LW = oldLW;
        return this;
    };

    window.LW = LW;
}

// define LW for Node module pattern loaders, including Browserify
if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = LW;

// define LW as an AMD module
} else if (typeof define === 'function' && define.amd) {
    define(LW);
}

if (typeof window !== 'undefined') {
    expose();
}


// 资源池 Tip:key为资源地址
LW.ResourceCache = L.Class.extend({
    imageCache:{},

    getImage:function (key, fn) {
        var self = this;
        return new Promise(function (resolve, reject) {
            var cachedObj = self.imageCache[key];
            if (!cachedObj) {
                cachedObj = new Image();
                cachedObj.onload = function () {
                    self.imageCache[key] = cachedObj;
                    if(fn) fn(cachedObj);
                    else resolve(cachedObj);
                };
                cachedObj.src = key;
            }
            else{
                if(fn) fn(cachedObj);
                else resolve(cachedObj);
            }
        });
    }
});

LW.ResourceCache = LW.ResourceCache.prototype;


// 矢量池 Tip:key为资源地址
LW.VectorCache = L.Class.extend({
    circleCache:{},
    triangleCache:{},
    rectCache:{},

    circle:function (r, fill, stroke, strokeWidth) {
        var key = r+fill+(stroke?stroke+strokeWidth:'');
        var obj = this.circleCache[key];
        if(!obj){
            obj = this.circleCache[key] = L.DomUtil.create('canvas');
            obj.width = r*4;//Tip:为了有描边的点也够绘制，所以增加了cache canvas的大小
            obj.height = r*4;
            var ctx = obj.getContext('2d');
            ctx.beginPath();
            ctx.fillStyle = fill;
            ctx.arc(r*2, r*2, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.closePath();
            if(stroke){
                ctx.strokeStyle = stroke;
                ctx.lineWidth = strokeWidth;
                ctx.stroke();
            }
        }
        return obj;
    },

    triangle:function (side, fill, stroke, strokeWidth) {
        var key = side+fill+(stroke?stroke+strokeWidth:'');
        var obj = this.triangleCache[key];
        if(!obj){
            obj = this.triangleCache[key] = L.DomUtil.create('canvas');
            obj.width = side*2;//Tip:为了有描边的点也够绘制，所以增加了cache canvas的大小
            obj.height = side*2;
            var width=side,height=Math.sqrt(Math.pow(side,2)-Math.pow(side/2,2));
            var x=side-width/2,y=side+height/2;
            var ctx = obj.getContext('2d');
            ctx.beginPath();
            ctx.moveTo(x , y);
            ctx.lineTo(x + width, y);
            ctx.lineTo(x + width/2, y - height);
            ctx.lineTo(x, y);
            ctx.fillStyle = fill;
            ctx.fill();
            ctx.closePath();
            if(stroke){
                ctx.strokeStyle = stroke;
                ctx.lineWidth = strokeWidth;
                ctx.stroke();
            }
        }
        return obj;
    },


    rect:function (side, fill, stroke, strokeWidth,rotation) {
        var key = side+fill+(stroke?stroke+strokeWidth:'')+(rotation?'r'+rotation:'');
        var obj = this.rectCache[key];
        if(!obj){
            obj = this.rectCache[key] = L.DomUtil.create('canvas');
            obj.width = side*2;//Tip:为了有描边的点也够绘制，所以增加了cache canvas的大小
            obj.height = side*2;
            var ctx = obj.getContext('2d');
            if(rotation){
                ctx.translate(side, side);
                ctx.rotate(rotation * Math.PI / 180);
                ctx.translate(-side, -side);
            }

            ctx.beginPath();
            ctx.rect(side-side/2, side-side/2, side, side);
            ctx.closePath();
            if(fill){
                ctx.fillStyle = fill;
                ctx.fill();
            }
            if(stroke){
                ctx.strokeStyle = stroke;
                ctx.lineWidth = strokeWidth;
                ctx.stroke();
            }
        }
        return obj;
    }
});

LW.VectorCache = LW.VectorCache.prototype;


/**
 * @module Model
 */

/**
 * 分级模型
 *
 * 该模型的作用为在海量点应用的时候，可根据不同的地图等级计算在该等级上的展示的点
 *
 * Features :
 *      1. 根据指定像素进行网格化，一个网格显示一个站点。
 *      2. 当站点为自动站点时，
 *          （1）国家站固定模式：
 *               国家站永远展示
 *          （2）国家站不固定模式：
 *               并且当指定像素格点内里面出现多个站点时，显示优先级为：国家站（省->市->县）->区域站
 *      3. 当站点展示等级并列时，展示指定值最大/最小的点 或  距离格点左上角最近的点 或 随机展示
 *      4. 一次性计算所有地图等级的格点
 *
 * Update Note：
 *      + v1.5.0-alpha ：Created
 *
 * @class LW.LODModel
 * @extends L.Class
 * @constructor
 * @demo demo/model/grading.html  {自动站分级}
 */

LW.LODModel=L.Class.extend({
    options:{
        /**
         * 网格大小
         * @property cellSize
         * @type {int}
         * @default 60
         */
        cellSize:60,
        /**
         * 计算的最大等级
         * @property maxZoom
         * @type {int}
         * @default 13
         */
        maxZoom:13,
        /**
         * 计算的最小等级
         * @property minZoom
         * @type {int}
         * @default 0
         */
        minZoom:0,
        /**
         * 值字段
         * @property valueField
         * @type {string}
         * @default null
         */
        valueField:null,
        /**
         * 经度字段
         * @property lonField
         * @type {string}
         * @default STATIONLON
         */
        lonField:"STATIONLON",
        /**
         * 纬度字段
         * @property latField
         * @type {string}
         * @default STATIONLAT
         */
        latField:"STATIONLAT",
        /**
         * 升降序标识 desc/asc
         * @property order
         * @type {string}
         * @default desc
         */
        order:"desc",
        /**
         * 是否自动站
         * @property isZdz
         * @type {Boolean}
         * @default true
         */
        isZdz:true,
        /**
         * 权重模式
         *
         * 说明：
         *      1. 当weightMode=-1时 网格内的站点随机出现
         *      2. 当weightMode=0时  网格内的站点出现最大值或最小值   此时valueField(值参数)、order（升降序）需配置
         *      3. 当weightMode=1时，网格内的站点出现离格点左上角最近的点，此时valueField(值参数)、order（升降序）失效
         * @property weightMode
         * @type {int}
         * @default 0
         */
        weightMode:0,
        /**
         * 固定的边界
         *
         * 快速查找latLngBounds的方法:
         *      1. latLngBounds参数暂时不传入,或传入null
         *      2. 取出所有站点(全国站、区域站、周边站)的值传入数据模型，
         *      3. 在控制台将输出latLngBounds的提示，如：分级显示提示：GradingModel._latlngBounds:LatLng(34.45, 115.2833) LatLng(29.7167, 119.4167)
         *      4. 将输出的经纬作为latLngBounds参数传入模型中
         * @property latLngBounds
         * @type {Array|L.LatLngBounds}
         * @default null
         */
        latLngBounds:null,
        /**
         * 当地图超过所配置的最大等级时，展示所有点(包括无效点，例如无经纬度的点)
         * @property maxShowAll
         * @type {Boolean}
         * @default false
         */
        maxShowAll:false,
        /**
         * 展示出现在固定边界外的点
         * @property showOutBounds
         * @type {Boolean}
         * @default true
         */
        showOutBounds:true,
        /**
         * 固定国家站
         *
         * 说明：
         *      1. 当isZdz=true时：
         *          （1）fixCountryStations=true 国家站永远展示
         *          （2）fixCountryStations=false 优先展示国家站（省->市->县）->区域站
         *      2. 当isZdz=false时：
         *          fixCountryStations属性失效
         * @property fixCountryStations
         * @type {Boolean}
         * @default true
         */
        fixCountryStations:true,
        /**
         * 属性[fixField]=true的站点不参与分级
         */
        fixField:null
    },
    initialize:function (map,options) {
        L.setOptions(this, options);
        var that=this,i;
        this._map=map;

        this._cellData=new Array(20);
        this._resultData=new Array(20);
        for(i=0;i<this._resultData.length;i++)
        {
            that._resultData[i]=[];
        }
    },
    /**
     * 设置数据
     * @param data
     */
    setData:function (data) {
        var that=this;
        var latlngs=[],i,order,zdzWeight;
        this.alldata=_.clone(data);
        this.outlatlngs=[];
        this._cellData=new Array(20);
        this._resultData=new Array(20);
        for(i=0;i<this._resultData.length;i++)
        {
            that._resultData[i]=[];
        }

        data=_.filter(data,function (item) {
            if(item[that.options.latField]==null||item[that.options.lonField]==null)
                return false;
            else {
                item.latlng=L.latLng(item[that.options.latField],item[that.options.lonField]);
                if(that.options.fixField&&item[that.options.fixField]){
                    item.minZoom=0;
                    item.maxZoom=18;
                    that.outlatlngs.push(item);
                    return false
                }
                if(that.options.latLngBounds!=null){
                    if(that.options.latLngBounds.contains(item.latlng))
                        return true;
                    else{
                        that.outlatlngs.push(item);
                        return false;
                    }
                }
                else
                    return true;
            }
        });

        order=this.options.order=="desc"?-1:1;
        data.forEach(function (item) {
            //item.latlng=L.latLng(item[that.options.latField],item[that.options.lonField]);
            item.showWeight=(that.options.valueField!=null&&item[that.options.valueField]!=null)?0:60000;
            item.maxZoom=18;
            item.minZoom=that.options.maxZoom;
            if(that._hasValueOrder()){
                item.showWeight+=order*item[that.options.valueField];
            }
            if(that.options.isZdz){
                zdzWeight=that._getZdzWeight(item);
                zdzWeight!=0?item.isCountryStation=true:item.isCountryStation=false;
                item.showWeight+=zdzWeight;
            }
            latlngs.push(item.latlng);
        })
        this._sourceData=data;
        this._latlngBounds=this.options.latLngBounds||L.latLngBounds(latlngs);
        if(!this.options.latLngBounds&&this._latlngBounds.isValid())
            console.info("分级显示提示：GradingModel._latlngBounds:"+this._latlngBounds.getNorthWest()
                + " "+this._latlngBounds.getSouthEast());

        if(that.outlatlngs.length>1){
            console.warn("分级显示警告：经纬度边界配置可能有错误，其中有"+that.outlatlngs.length+"个站点不在经纬度边界范围内");
        }

    },

    _sortByZoom:function (zoom) {
        var rows=this._cellData[zoom].length;
        var columns,j,k,item,l,m,i=zoom;
        for(j=0;j<rows;j++)
        {
            columns=this._cellData[i][j].length;
            for(k=0;k<columns;k++)
            {
                if(this._cellData[i][j][k]!=null){
                    this._cellData[i][j][k]=_.sortBy(this._cellData[i][j][k],function (item) {
                        return  item["showWeight"+i];
                    })
                    item=this._cellData[i][j][k][0];
                    if(item.minZoom>i)
                        item.minZoom=i;
                    this._resultData[i].push(item);

                    if(this.options.isZdz&&this.options.fixCountryStations){
                        l=this._cellData[i][j][k].length;
                        for(m=1;m<l;m++)
                        {
                            item=this._cellData[i][j][k][m];
                            if(item.isCountryStation){
                                if(item.minZoom>i)
                                    item.minZoom=i;
                                this._resultData[i].push(item);
                            }
                            else{
                                break;
                            }
                        }
                    }
                }
            }
        }

    },

    /**
     * 返回数据
     * @param lvl
     * @return {*}
     */
    getData:function (zoom) {
        zoom=Math.floor(zoom);
        if(zoom<this.options.minZoom)
            zoom=this.options.minZoom;
        else if(zoom>this.options.maxZoom)
            return this.options.maxShowAll?this.alldata:((this.options.latLngBounds!=null&&this.options.showOutBounds)?this._sourceData.concat(this.outlatlngs):this._sourceData);

        if(this._resultData[zoom].length==0){
            this._createZoomData(zoom);
            this._sortByZoom(zoom);
        }
        return (this.options.latLngBounds!=null&&this.options.showOutBounds)?this._resultData[zoom].concat(this.outlatlngs):this._resultData[zoom];
    },
    _hasValueOrder:function () {
        return this.options.weightMode==0&&this.options.valueField!=null&&this.options.valueField!="";
    },
    /**
     * 返回自动站显示权重值
     * @param item
     * @private
     */
    _getZdzWeight:function (item) {
        var indexOf=-1;
        if(item["STATIONLEVEL_XZ"]!=null&&item["STATIONLEVEL_XZ"]!=""){
            indexOf=item["STATIONLEVEL_XZ"].indexOf("1");
        }
        if(indexOf==0)
            return -500000;
        else if(indexOf==1)
            return -400000;
        else if(indexOf==2)
            return -300000;
        else if(item["STATIONLEVEL_TYPE"]=="011"||item["STATIONLEVEL_TYPE"]=="012"||item["STATIONLEVEL_TYPE"]=="013")
            return -200000;
        else
            return 0;
    },
    /**
     * 创建单等级数据
     * @param lvl
     * @private
     */
    _createZoomData:function (zoom) {
        var that=this,i;
        var leftTopPoint=this._map.project(this._latlngBounds.getNorthWest(),zoom);
        var rightBottomPoint=this._map.project(this._latlngBounds.getSouthEast(),zoom);
        var rowNum=Math.ceil((rightBottomPoint.y-leftTopPoint.y)/this.options.cellSize);
        var columnNum=Math.ceil((rightBottomPoint.x-leftTopPoint.x)/this.options.cellSize);
        this._cellData[zoom]=new Array(rowNum);
        for(i=0;i<rowNum;i++)
        {
            that._cellData[zoom][i]=new Array(columnNum);
        }
        this._sourceData.forEach(function (item) {
            var p=that._getPosByPoint(item,zoom,leftTopPoint);
            if(p==null)
                return;
            if(that._cellData[zoom][p.y][p.x]==null){
                that._cellData[zoom][p.y][p.x]=[];
            }
            that._cellData[zoom][p.y][p.x].push(item);
        })
    },

    /**
     * 返回指定点的行、列位置
     * @private
     * @return  p.x 列  p.y 行
     */
    _getPosByPoint:function (item,zoom,leftTopPoint) {
        if(item.latlng==null)
            return null;
        var p=this._map.project(item.latlng,zoom);
        var w=p.x-leftTopPoint.x;
        var h=p.y-leftTopPoint.y;
        item["showWeight"+zoom]=item.showWeight;
        if(this.options.weightMode==1)
            item["showWeight"+zoom]+=this._getDisWeight(w,h,this.options.cellSize);
        return L.point(parseInt(w/this.options.cellSize),parseInt(h/this.options.cellSize))
    },
    /**
     * 计算距离权重
     * @param w
     * @param h
     * @param size
     * @private
     */
    _getDisWeight:function (w,h,size) {
        return Math.sqrt(Math.pow(w%size,2)+Math.pow(h%size,2));
    }
});

/**
 * 数据模型
 * @module Model
 */

/**
 * 网格模型
 *
 * Features :
 *      1. 包含风和非风类网格模型
 *      2. 非风类按数据精度存储值，风类在由uv分量转为speed和dir时转为数据精度
 *      3. 模型变换：基础变换、比例变换、权重变换、落区工具、风向变换
 *
 * Update Note：
 *      + v1.1.0-dev ：Created
 *      + v1.4.2 : 增加可以根据区域掩码网格，在设置数据或者编辑变换时只针对指定区域操作
 *      + v1.4.6 : 增加validRange的配置，在transform_base时判定超出validRange的发出invalidApply事件，并不应用无效格
 *      + v1.4.8 : 增加风类型参考数据只应用风速的功能
 *      + v1.5.2 : 1. transform_base增加fx参数，可判断单格是否应用变换
 *                 2. 增加是否只显示异常值的配置-abnormalOnly
 *                 3. 权重变化增加定制或增减的变化参数
 *
 * @class LW.GridModel
 * @extends L.Evented
 */
LW.GridModel = L.Evented.extend({
    options:{
        /**
         * 数据源类型 可为nc/json/gridInt
         * @property dataType
         * @type {string}
         * @default 'nc'
         */
        dataType:"nc",

        /**
         * 在风类型时，是否在创建网格的时候生成风速网格，主要用于GradientGlLayer的uv数据展示
         */
        dataSpeed:false,

        /**
         * 是否是风的模型
         * @property wind
         * @type {Boolean}
         * @default false
         */
        wind:false,

        /**
         * 是否是数值连贯的数据,主要用于图例数据区别
         * @property continuity
         * @type {Boolean}
         * @default true
         */
        continuous:true,

        /**
         * 区域掩码网格，一维网格，可通过Sun.Util.Grid.getRegionGrid方法生成；
         * 同一项目若是固定的网格经纬，推荐生成一次后，保存成文件，后续直接使用
         * @property regionGrid
         * @type {Array}
         * @default null
         */
        regionGrid:null,

        /**
         * 值的有效范围 eg:[min,max],[-20,20],[0,600] 包含min,max
         * @property validRange
         * @type {null|Array}
         * @default null
         */
        validRange:null,

        /**
         * 只展示异常值，该属性为true时网格item为{value:x,abnormal:true}的才展示，否则不展示
         */
        abnormalOnly:false,

        //[Deprecated]
        showFineGrid:false,//是否展示精细网格
        fineGridOptions:{
            nlat:0.01,
            nlon:0.01,
            bounds:null
        }
    },

    initialize : function (options) {
        L.setOptions(this,options);
    },

    /**
     * 设置数据
     * @method setData
     * @param source
     * @param applyRegions {Array} [可选] 设置应用的区域。一维网格，存储应用区域的key,[1,5,..]
     *          若设定区域时，指定区域对应的网格设置新的数据，非该指定的区域，保留原先网格值，需要有设置好的options.regionGrid
     * @param keepValidGrid {Boolean} [可选] 是否保留原先网格的有效值，若新数据的某个网格为无效值时，保留原先网格值
     * @param applyWindSpeed {Boolean} [可选] 该参数用于options.wind为true,但应用的数据只希望应用风速时使用
     * @param fireTransform {Boolean|undefined}
     */
    setData : function (source,applyRegions,keepValidGrid,applyWindSpeed,fireTransform) {
        this.source = source;
        this.applyRegions = applyRegions;
        this.keepValidGrid = keepValidGrid;
        this.applyWindSpeed = applyWindSpeed;
        // 数据处理
        if(this.options.dataType=='nc'){
            if(!applyWindSpeed){
                this.ncReader = new Sun.NCReader(source);
                this.data = Sun.Util.Data.changeGridNcToJson(this.ncReader);
            }
            else{
                var data = Sun.Util.Data.changeGridNcToJson(source);
                this.data.data = data.data;
            }
        }
        else if(this.options.dataType == 'gridInt'){
            if(!this.gridIntReader)
                this.gridIntReader = new Sun.GridInt16Reader();
            this.data = this.gridIntReader.readData(source);
        }
        else if(this.options.dataType=='json')
            this.data = source;
        // this.valueField = this.data.elementCode;
        if(this.options.wind && !applyWindSpeed){
            this.dataU = this.data.data[0];
            this.dataV = this.data.data[1];
        }
        this.data.latSign = this.data.nlat>0?1:-1;
        this.bounds = L.latLngBounds([[this.data.startlat, this.data.startlon], [this.data.endlat, this.data.endlon]]);
        // 创建网格
        this._buildGrid();

        // 发送transform事件
        fireTransform = typeof fireTransform === 'undefined' ? true : fireTransform;
        if(fireTransform)
            this._fireTransform();
    },

    _fireTransform:function () {
        // 是否展示精细网格[Deprecated]
        // if(this.options.showFineGrid){
        //     var fgOpt = this.options.fineGridOptions;
        //     this.fineGridData = this.getFineGrid(fgOpt.nlat,fgOpt.nlon,fgOpt.bounds);
        // }

        this.fire('transform');
    },

    resetDataByGrid:function () {
        if(this.applyWindSpeed)
            this.data.data = [[],[]];
        for (var row_i = 0, p=0; row_i < this.data.latsize; row_i++) {
            for (var column_i = 0; column_i < this.data.lonsize; column_i++, p++) {
                var gItem = this.grid[row_i][column_i];
                gItem = gItem.covered ? gItem.value :gItem;
                if(this.options.wind){
                    this.data.data[0][p] = gItem[0];
                    this.data.data[1][p] = gItem[1];
                }
                else
                    this.data.data[p] = gItem;
            }
        }
    },

    /**
     * 获取数据
     * @method getData
     * @param returnType {string} json/nc
     */
    getData: function (returnType) {
        returnType = returnType || 'json';
        this.resetDataByGrid();
        if(returnType=='json')
            return this.data;
        else if(returnType=='nc')
            return this.ncReader.getNewBuffer(this.data,this.options.wind);
    },

    /**
     * 获取nc数据的属性
     * @param field
     * @returns {*}
     */
    getAttribute: function (field) {
        if(this.ncReader)
            return this.ncReader.getAttribute(field);
    },

    /**
     * 设置nc数据的数据
     * @param field
     * @param value
     */
    setAttribute: function (field,value) {
        if(this.ncReader)
            this.ncReader.setAttribute(field,value);
    },

    resetGrid: function (grid) {
        this.grid = grid;
        this._fireTransform();
    },

    _buildGrid: function () {
        var grid_bk = this.applyRegions || this.keepValidGrid || this.applyWindSpeed ? Sun.Util.Data.deepClone(this.grid) : null;

        var self = this;
        var rows = this.data.latsize,columns = this.data.lonsize;
        this.grid = new Array(rows);
        var isWind = this.data.GridType == 11 && this.options.dataSpeed;
        if(isWind)//Tip: 若是GridInt16的11类数据，计算出网格风速用于gl渲染的纹理
            var speed = new Int16Array(rows*columns);
        for (var row_i = 0,p = 0; row_i < rows; row_i++) {
            var row = new Array(columns);
            for (var column_i = 0; column_i < columns; column_i++, p++) {
                var item = getItem(p);
                row[column_i] = item;
                if(isWind)
                    speed[p] = Sun.Util.Weather.wind_getWindByUV(item,1).speed*10;
            }
            this.grid[row_i] = row;
        }

        if(isWind)
            this.data.speed = speed;

        function getItem(p) {
            var item = self.applyWindSpeed?self.data.data[p]:self._getItem(p);
            if(grid_bk){
                if(self.applyRegions && self.options.regionGrid){//应用指定区域的网格为新数据，此外的网格为原先数据
                    var reg = self.options.regionGrid[p];
                    if(self.applyRegions.indexOf(reg)===-1)//若该网格的为非指定区域的网格，则用原先的网格，不变
                        item = grid_bk[row_i][column_i];
                }
                else if(self.keepValidGrid && grid_bk && self.isInvalid(item)) {//如果保留有效网格，且该网格为无效值用原先网格
                    item = grid_bk[row_i][column_i];
                }
                else if(self.applyWindSpeed){// 只应用风速
                    var bk = grid_bk[row_i][column_i];
                    var wValue = Sun.Util.Weather.wind_getWindByUV(bk);
                    item = Sun.Util.Weather.wind_getUVByWind(item,wValue.dir,1);
                }
            }

            return item;

        }
    },

    /**
     * 设置区域,regions为null/undefined时为不限定指定区域
     * @param regions {Array|null|undefined} eg:[5,8] | null
     */
    setRegions:function(regions){
        this.regions = regions;
    },

    /**
     * 设置有效值范围，即设置options.validRange
     * @method setValidRange
     * @param range
     */
    setValidRange:function(range){
        this.options.validRange = range;
    },

    isEditable:function(grid,idx){
        var regionGrid = this.options.regionGrid;
        if(this.isHide(grid))
            return false;
        else if(regionGrid && this.regions) {// 网格不在指定的区域内，无需编辑
            var inRegion = this.regions.indexOf(regionGrid[idx]) !== -1;
            if (!inRegion) return false;
        }
        return true;
    },

    isHide:function (value) {
        var fixedValue = this.data.fixedValue;// fixedValue的用处？
        if(value.covered)// 网格被其他网格覆盖的
            return true;
        else if(this.options.abnormalOnly)// 改属性时只展示abnormal为true的值
            return !value.abnormal;
        else{
            if(this.options.wind)
                return value[0] == fixedValue || value[1] == fixedValue;
            else
                return value == fixedValue;
        }
    },

    isInvalid:function (value) {
        var invalidValue = this.data.invalidValue;
        // if(Sun.Util.Common.isValid(value)){
        if(value!=null){
            if(this.options.wind)
                return value[0] == invalidValue || value[1] == invalidValue;
            else
                return value == invalidValue;
        }
        else
            return true;
    },

    inValidRange:function(value){
        var range = this.options.validRange;
        if(!range)
            return true;
        else{
            if(this.options.wind)
                return value[0]>=range[0] && value[0]<=range[1] && value[1]>=range[0] && value[1]<=range[1];
            else
                return value>=range[0] && value<=range[1];
        }
    },

    _getItem: function (i) {
        var pcs = this.data.DataPrecision || 1;
        if(this.data)
            return this.options.wind ?[this.dataU[i]/pcs, this.dataV[i]/pcs]:this.data.data[i]/pcs;
    },

    /**
     * 获取指定网格点的经纬
     * @method getCellLatLng
     * @param row
     * @param column
     * @private
     */
    getCellLatLng: function (row, column) {
        var data = this.data;
        return L.latLng(data.startlat + data.nlat * row, data.startlon + data.nlon * column);
    },

    _getPrecisionValue:function (value) {
        var p = this.data.precision;
        if(L.Util.isArray(value))
            return value;
            // return [Sun.Util.Math.toRoundFixed(value[0],p),Sun.Util.Math.toRoundFixed(value[1],p)];
        else
            return Sun.Util.Math.toRoundFixed(value,p);
    },

    _getValidValue:function (value) {
        var _value,invalidValue = this.data.invalidValue,fixedValue = this.data.fixedValue;
        if(this.options.wind){
            _value = [];
            _value[0] =  valid(value[0]);
            _value[1] =  valid(value[1]);
        }
        else
            _value = valid(value);
        return _value;

        function valid(v) {
            return v == invalidValue || v == fixedValue? 0: v;
        }
    },

    get4GridsIndexByLatlng:function (latlng) {
        var rank = this._getRankByLatlng(latlng);
        var f_row = Math.floor(rank.row), c_row = f_row + 1;
        var f_column = Math.floor(rank.column), c_column = f_column + 1;
        return {f_row:f_row,c_row:c_row,f_column:f_column,c_column:c_column};
    },

    /**
     * 获取某经纬度最近的网格
     * @method getClosestGridByLatlng
     * @param latlng {L.LatLng} 经纬度
     * @param interval {number} 网格间隔，不传时默认为数据中的nlon/nlat,可传原始数据nlon/nlat的整数据倍间隔
     * @returns {{row: number, column: number}}
     */
    getClosestGridByLatlng:function (latlng,interval) {
        var rank = this._getRankByLatlng(latlng,interval);
        var times = typeof interval == 'undefined' ? 1 : interval/this.data.nlon;
        return {row:Math.round(rank.row) * times ,column:Math.round(rank.column) * times};
    },

    _getRankByLatlng:function (latlng,interval) {
        var x0 = this.data.startlon, y0 = this.data.startlat;
        var dx = interval || this.data.nlon, dy = interval * this.data.latSign || this.data.nlat;
        var row = (latlng.lat - y0) / dy;
        var column = (latlng.lng - x0) / dx;
        return {row: row, column: column};
    },

    _getLatlngByRank:function (row,column) {
        var x0 = this.data.startlon, y0 = this.data.startlat;
        var dx = this.data.nlon, dy = this.data.nlat;
        var lat = dy * row + y0 , lng = dx * column + x0;
        return L.latLng(lat,lng);
    },

    /**
     * 根据经纬度获取该点根据双线性插值得到的值
     * @method getInterpolation
     * @param lat {number}
     * @param lng {number}
     * @return {number|Array|null}
     */
    getInterpolation:function(lat,lng,valueFn){
        var self = this;
        var rank = this._getRankByLatlng({lat:lat,lng:lng});
        var idx4 = this.get4GridsIndexByLatlng({lat:lat,lng:lng});
        var g00 = this.getGrid(idx4.f_row,idx4.f_column);
        var g10 = this.getGrid(idx4.f_row,idx4.c_column);
        var g01 = this.getGrid(idx4.c_row,idx4.f_column);
        var g11 = this.getGrid(idx4.c_row,idx4.c_column);

        if(this.isInvalid(g00) || this.isInvalid(g01) || this.isInvalid(g10) || this.isInvalid(g11))
            return null;
        else
            return this._bilinearInterpolation(rank.column - idx4.f_column, rank.row - idx4.f_row,
                _getValue(g00), _getValue(g10), _getValue(g01), _getValue(g11));

        function _getValue(grid) {
            // return grid.covered ? grid.value : grid;
            return valueFn ? valueFn(grid) : grid;
        }
    },

    _bilinearInterpolation: function (x, y, g00, g10, g01, g11) {
        if(this.options.wind){
            var u = this._bilinearInterpolate(x, y, g00[0], g10[0], g01[0], g11[0]);
            var v = this._bilinearInterpolate(x, y, g00[1], g10[1], g01[1], g11[1]);
            return [u, -v, Math.sqrt(u * u + v * v)];
        }
        else
            return this._bilinearInterpolate(x, y, g00, g10, g01, g11);
    },

    _bilinearInterpolate: function (x, y, g00, g10, g01, g11) {
        var rx = (1 - x);
        var ry = (1 - y);
        return g00 * rx * ry + g10 * x * ry + g01 * rx * y + g11 * x * y;
    },

    /**
     * 根据Rank获取其在一维网格中的索引
     * @method getIdxByRank
     * @param row {int}
     * @param column {int}
     * @returns {*}
     */
    getIdxByRank:function (row,column) {
        return parseInt(column)+row*this.data.lonsize;
    },
    /**
     * 根据索引获取Rank
     * @method getRankByIdx
     * @param idx {int}
     * @returns {*}
     */
    getRankByIdx: function(idx){
        var x0 = this.data.lonsize;
        var row = Math.floor(idx/x0), column = idx%x0;
        return {row:row,column:column};
    },

    /**
     * 判断所给的row，column指向的格点是否在网格内
     * @method inGrid
     * @param row {int}
     * @param column {int}
     * @returns {boolean}
     */
    inGrid:function (row,column) {
        return row>=0 && row<this.data.latsize && column>=0 && column<this.data.lonsize;
    },

    /**
     * 根据所给的row，column获得指向的格点
     * @method getGrid
     * @param row {int}
     * @param column {int}
     * @returns {number|array|null}
     */
    getGrid:function (row,column) {
        return this.inGrid(row,column)?this.grid[row][column] : null;
    },

    /**
     * 设置指定格点的值
     * @method setGridItem
     * @param row {int}
     * @param column {int}
     * @param value {Number|Array.<Number>} 值
     * @param fireTransform {Boolean} 是否触发渲染
     */
    setGridItem: function (row,column,value,fireTransform) {
        if(this.inGrid(row,column)){
            if(!this.options.wind)
                this.grid[row][column] = value;
            else{
                if(L.Util.isArray(value) && value.length==2)
                    this.grid[row][column] = value;
                else{
                    var uv = this.grid[row][column];
                    var wind = Sun.Util.Weather.wind_getWindByUV(uv);
                    this.grid[row][column] = Sun.Util.Weather.wind_getUVByWind(value,wind.dir,1);
                }
            }
            if(fireTransform)
                this._fireTransform();
        }
    },

    /**
     * 遍历指定的格点Item
     * @method eachItems
     * @param fun {Function} 回调
     * @param context {LW.GridModel} this
     * @param indexes {String} 指定的格点，格式为"row_column,row_column",eg:"3_5,4_2"
     */
    eachItems:function (fun, context, indexes) {
        for(var i=0;i<indexes.length;i++) {
            var index = indexes[i].split('_');
            var row = index[0], column = index[1];
            fun(context,row,column,context.getIdxByRank(row,column),i);
        }
    },

    /**
     * 遍历所有格点
     * @method eachGrid
     * @param fun {Function} 回调
     * @param context {LW.GridModel} this
     */
    eachGrid:function (fun, context) {
        for(var row_i=0,i=0;row_i<context.grid.length;row_i++){
            var row = context.grid[row_i];
            for(var column_i=0;column_i<row.length;column_i++,i++){
                fun(context,row_i,column_i,i);
            }
        }
    },

    getMinMaxOfGrids:function (indexes) {
        var s_min,s_max;
        var forFun = indexes == 'all' ? this.eachGrid: this.eachItems;
        forFun(function (self,row,column,idx) {
            var _grid = self.grid[row][column];
            if(self.isEditable(_grid,idx)){
                var value = self._getValidValue(_grid);
                if (self.options.wind)
                    value = Sun.Util.Weather.wind_getWindByUV(value).speed;
                if (typeof s_min == 'undefined')
                    s_min = s_max = value;
                else {
                    if (value < s_min) s_min = value;
                    if (value > s_max) s_max = value;
                }
            }
        },this,indexes);

        return {min:Sun.Util.Math.toRoundFixed(s_min,1),max:Sun.Util.Math.toRoundFixed(s_max,1)};
    },

    //---改变模型数据---//
    /**
     * 基础变换 -- 支持加、减、等运算
     * @method transform_base
     * @param indexes {Array|String} 需要需要的索引 eg:[]||'all'
     * @param type {string} plus/sub/equal
     * @param value {number}
     * @param range [optional] {Array} null/[NaN,10]/[10,20]
     * @param fx [optional] {function} 用网格值和网格索引判断指定网格是否按指定规则应用的方法
     *                      eg: function(gValue,row,column,idx) {return true/false;}
     */
    transform_base: function (indexes,type,value,range,fx) {
        var forFun = indexes == 'all' ? this.eachGrid: this.eachItems;
        var invalidValues=[];
        forFun(function (self,row,column,idx) {
            var _grid = self.grid[row][column];
            if(self.isEditable(_grid,idx)){
                var gValue = self._getValidValue(_grid);
                if(self.options.wind){
                    var wValue = Sun.Util.Weather.wind_getWindByUV(gValue);
                    gValue = wValue.speed;
                }

                if(!fx || (fx && fx(gValue,row,column,idx))){
                    if(isChanging(gValue,range)) {
                        switch (type) {
                            case 'plus':
                                gValue += value;
                                break;
                            case 'sub':
                                gValue -= value;
                                break;
                            case 'equal':
                                gValue = value;
                                break;
                        }
                        if (self.options.wind) {
                            var uv = Sun.Util.Weather.wind_getUVByWind(gValue, wValue.dir,0,2);//Tip:若只保留一位，计算过程会有精度误差
                            gValue = [uv.u, uv.v];
                        }
                        if(self.inValidRange(gValue))
                            self.grid[row][column] = self._getPrecisionValue(gValue);
                        else if(invalidValues.length<5)
                            invalidValues.push({value:gValue,latlng:self._getLatlngByRank(row,column)})
                    }
                }
            }
        },this,indexes);
        if(invalidValues.length>0)
            this.fire('invalidApply',invalidValues);
        this._fireTransform();

        function isChanging(value,range) {
            if(range==null)
                return true;
            if(L.Util.isArray(range)){
                if(isNaN(range[0]))
                    return value<=range[1];
                else if (isNaN(range[1]))
                    return value>=range[0];
                else
                    return value>=range[0] && value<=range[1];
            }
        }
    },

    /**
     * 比例变换 -- 按原先值在最大最小值中的比例，变换为新的传入最大最小值中的比例
     * @method transform_ratio
     * @param indexes {Array|String} 需要需要的索引 eg:[]||'all'
     * @param min {number} 最小值
     * @param max {number} 最大值
     * @param sMinMax{Object} 这些网格原始的最大最小值
     */
    transform_ratio: function (indexes,min,max,sMinMax) {
        var forFun = indexes == 'all' ? this.eachGrid: this.eachItems;
        // 获取原数据的最大最小值
        sMinMax = sMinMax || this.getMinMaxOfGrids(indexes);
        var s_min = sMinMax.min,s_max = sMinMax.max;

        // 按新比例分配
        // (s_v-s_min)/(s_max-s_v) = (v-min)/(max-v) = ratio;
        //  ---> v = (ratio*max+min)/(ratio+1);
        forFun(function (self,row,column,idx) {
            var _grid = self.grid[row][column];
            if(self.isEditable(_grid,idx)){
                var s_v = self._getValidValue(_grid), v;
                if (self.options.wind) {
                    var wValue = Sun.Util.Weather.wind_getWindByUV(s_v);
                    s_v = wValue.speed;
                }
                if (s_v == s_min) v = min;
                else if (s_v == s_max) v = max;
                else {
                    var ratio = (s_v - s_min) / (s_max - s_v);
                    v = (ratio * max + min) / (ratio + 1);
                }

                if (self.options.wind) {
                    var uv = Sun.Util.Weather.wind_getUVByWind(v, wValue.dir);
                    v = [uv.u, uv.v];
                }
                self.grid[row][column] = self._getPrecisionValue(v);
            }
        },this,indexes);
        this._fireTransform();
    },

    /**
     * 简单的函数变换
     * @param indexes {Array|String} 需要需要的索引 eg:[]||'all'
     * @param fx {Function} eg:function(value){return a*value+b};
     */
    transform_fx:function(indexes,fx){
        var forFun = indexes == 'all' ? this.eachGrid: this.eachItems;
        forFun(function (self,row,column,idx) {
            var _grid = self.grid[row][column];
            if(self.isEditable(_grid,idx)){
                if(!self.isInvalid(_grid)){
                    var gValue = self._getValidValue(_grid);
                    if(self.options.wind){
                        var wValue = Sun.Util.Weather.wind_getWindByUV(gValue);
                        gValue = wValue.speed;
                    }

                    // 按函数变换
                    gValue = fx(gValue,row,column,idx);

                    if (self.options.wind) {
                        var uv = Sun.Util.Weather.wind_getUVByWind(gValue, wValue.dir);
                        gValue = [uv.u, uv.v];
                    }
                    self.grid[row][column] = self._getPrecisionValue(gValue);
                }
            }
        },this,indexes);
        this._fireTransform();
    },

    /**
     * 权重变换 -- 在指定圈内根据离散点和圈值为指定网格插值
     * @method transform_ratio
     * @param indexes {Array} 需要需要的索引
     * @param ring {Object} 圈值及圈的控制点 eg:{value:20,latlngs:[]}
     * @param weightPoints {Array} 权重点集 eg:[{value:35,latlng:[]},...]
     * @param pow {int} 反距离插值的幂
     * @param type {string} 赋值类型。fixed|plus
     */
    transform_weight: function (indexes,ring,weightPoints,pow,isPlus) {
        pow = pow || 1;
        var forFun = indexes == 'all' ? this.eachGrid: this.eachItems;
        forFun(function (self,row,column,idx) {
            var _grid = self.grid[row][column];
            if(self.isEditable(_grid,idx)){
                // 插值圈上离插值点最近的控制点，并加入加权点集
                var latlng = self.getCellLatLng(row, column);
                var min_latlng = self._findClosePointInRing(latlng, ring);

                // 用加权点集，插值
                var points = weightPoints.concat({value: ring.value, latlng: min_latlng});
                var value = self._idw(latlng, points, pow);

                if (self.options.wind)
                    value = self._getGridUVOfNewSpeed(self.grid[row][column], value);
                else if(isPlus)
                    value = self._getValidValue(_grid) + value;
                self.grid[row][column] = self._getPrecisionValue(value);
            }
        },this,indexes);
        this._fireTransform();
    },

    /**
     * 落区网格化
     * @method transform_isoline
     * @param rings {Array} 落区 eg:[{value:20,latlngs:[]},...]
     * @param weightPoints {Array} 权重点集 eg:[{value:35,latlng:[]},...]
     */
    transform_isoline:function (rings,weightPoints) {
        var continuous = this.options.continuous;
        // 判断落区关系
        this._setRingRelationShip(rings);
        // 跟落区
        var roots = [];
        rings.forEach(function (item) {
            if(item.pid===-1)
                roots.push(item);
        });
        // 判断落区和点集关系
        if(continuous) {//非连续的无需权重点计算
            this._setPointRelationShipInRing(weightPoints, roots, rings);
            var outRingPoint = [];
            weightPoints.forEach(function (p) {
                if(p.pid == -1) outRingPoint.push(p);
            });
        }

        this.eachGrid(function (self,row,column,idx) {
            var _grid = self.grid[row][column];
            if(self.isEditable(_grid,idx)){
                var gValue, idwPoints = [];
                var latlng = self.getCellLatLng(row, column);
                var pid = self._getPidOfRingByLatlng(latlng, roots, rings);
                if (continuous) {
                    if (pid === -1) {// 所有跟节点外
                        roots.forEach(function (item) {
                            var m_latlng = self._findClosePointInRing(latlng, item);
                            idwPoints.push({value: item.value, latlng: m_latlng});
                        });
                        outRingPoint.forEach(function (p) {
                            idwPoints.push({value: p.value, latlng: p.latlng});
                        });
                        gValue = self._idw(latlng, idwPoints);
                    }
                    else {
                        var pRing = rings[pid];
                        pRing.cid.forEach(function (item) {
                            if (typeof item == 'number') {
                                var ring = rings[item];
                                var m_latlng = self._findClosePointInRing(latlng, ring);
                                idwPoints.push({value: ring.value, latlng: m_latlng});
                            }
                            else if (typeof item == 'object')
                                idwPoints.push({value: item.value, latlng: item.latlng});
                        });
                        idwPoints.push({value: pRing.value, latlng: self._findClosePointInRing(latlng, pRing)});
                        gValue = self._idw(latlng, idwPoints);
                    }
                }
                else
                    gValue = pid === -1 ? self.data.invalidValue : rings[pid].value;


                if (self.options.wind)
                    gValue = self._getGridUVOfNewSpeed(self.grid[row][column], gValue);
                if (pid != -1)
                    self.grid[row][column] = self._getPrecisionValue(gValue);
            }
        },this);
        this._fireTransform();
    },

    // 将原先的风格点值风速更新
    _getGridUVOfNewSpeed: function (gridUV,speed,isPlus) {
        var wValue = Sun.Util.Weather.wind_getWindByUV(gridUV);
        return Sun.Util.Weather.wind_getUVByWind(isPlus?(wValue.speed+speed):speed,wValue.dir,1,this.data.precision);
    },

    _idw:function (latlng,points,pow) {
        pow = pow || 1;
        var sgData = [],w=0;
        for(var n = 0;n<points.length;n++){
            var item = points[n];
            var d = Math.sqrt(Math.pow(latlng.lat - item.latlng.lat,2)+Math.pow(latlng.lng - item.latlng.lng,2));
            d = Math.pow(1 / d, pow);
            sgData.push({d: d, value: item.value});
            w += d;
        }

        var value = 0;
        for (var s = 0; s < sgData.length; s++) {
            var sg = sgData[s];
            value += sg.d / w * sg.value;
        }
        return value;
    },

    // 查找圈上最近的点
    _findClosePointInRing:function (latlng,ring) {
        var min_d,min_latlng;
        for(var m = 0;m<ring.latlngs.length;m++){
            var loc = ring.latlngs[m];
            var md = Math.sqrt(Math.pow(latlng.lat - loc.lat,2)+Math.pow(latlng.lng - loc.lng,2));
            if(m==0) {
                min_d = md;
                min_latlng = loc;
            }
            else if(min_d>md) {
                min_d = md;
                min_latlng = loc;
            }
        }
        return min_latlng;
    },

    // 设置落区关系
    _setRingRelationShip:function (rings) {
        // 初始化关系
        for(var k=0;k<rings.length;k++){
            var ring = rings[k];
            ring.id = k;
            ring.cid = [];
            ring.pid = -1;
        }
        for(var i=0;i<rings.length;i++){
            var line0 = rings[i];
            var p0 = line0.latlngs[0];
            for (var j = i + 1; j < rings.length; j++){
                var line1 = rings[j];
                var p1 = line1.latlngs[0];
                if (Sun.Util.Geometry.latlngInPolygon(p0, line1.latlngs)) {
                    // line0在line1里面
                    if (line0.pid===-1) {
                        line0.pid = j;
                        line1.cid.push(i);
                    }
                    else {
                        // 如果line0已经有parent，则比较line1与line0原parent（line2）的关系
                        // 如果line1在line2中，line0的parent变成line1，line2删掉line0这个child，多一个line1这个child
                        var line2 = rings[line0.pid];
                        if (Sun.Util.Geometry.latlngInPolygon(p1, line2.latlngs)) {
                            line2.cid.splice(line2.cid.indexOf(i), 1);
                            line0.pid = j;
                            line1.cid.push(i);
                        }
                    }
                }
                else if (Sun.Util.Geometry.latlngInPolygon(p1, line0.latlngs)) {
                    if (line0.pid===-1) {
                        line1.pid = i;
                        line0.cid.push(j);
                    }
                    else {
                        line2 = rings[line1.pid];
                        if (Sun.Util.Geometry.latlngInPolygon(p0, line2.latlngs)) {
                            line2.cid.splice(line2.cid.indexOf(j), 1);
                            line1.pid = i;
                            line0.cid.push(j);
                        }
                    }
                }
            }
        }
    },

    // 设置点与落区的关系
    _setPointRelationShipInRing:function (points,roots,rings) {
        for(var i=0;i<points.length;i++){
            var p = points[i];
            p.pid = this._getPidOfRingByLatlng(p.latlng,roots,rings);
            if(p.pid !== -1)
                rings[p.pid].cid.push(p);
        }
    },

    // 通过经纬度查找圈的Pid
    _getPidOfRingByLatlng:function (latlng,roots,rings) {
        var pid = -1;
        for (var i = 0; i < roots.length; i++){
            var line = roots[i];
            setPointPid(latlng,line);
        }
        return pid;

        function setPointPid(latlng,line) {
            if (Sun.Util.Geometry.latlngInPolygon(latlng, line.latlngs)) {
                // 点在line圈内
                if(line.cid &&　line.cid.length>0){
                    // 判断点是否在line子圈内
                    for(var k=0;k<line.cid.length;k++){
                        var cid = line.cid[k];
                        if(typeof cid == 'number'){
                            var line2 = rings[cid];
                            setPointPid(latlng,line2);
                        }
                    }
                    if(pid===-1)
                        pid = line.id;
                }
                else
                    pid = line.id;
            }
        }
    },

    /**
     * 区域权重工具
     * @method transform_areaWeight
     * @param indexes {Array|String} 需要需要的索引 eg:[]||'all'
     * @param values
     * @param bgPercent {Number} 百分比(0-1之间的数值)
     */
    transform_areaWeight:function (indexes,values,bgPercent) {
        this.eachItems(function(self, row, column, idx,i){
            var _grid = self.grid[row][column];
            if(self.isEditable(_grid,idx)){
                var value = values[i];
                var gValue = self._getValidValue(_grid);

                if(self.options.wind){
                    var wValue = Sun.Util.Weather.wind_getWindByUV(gValue);
                    gValue = wValue.speed;
                }
                if(bgPercent)
                    value += gValue*bgPercent;

                if(self.options.wind){
                    var uv = Sun.Util.Weather.wind_getUVByWind(value,wValue.dir);
                    value = [uv.u,uv.v];
                }

                self.grid[row][column] = self._getPrecisionValue(value);
            }
        },this,indexes);
        this._fireTransform();
    },

    /**
     * 区域移动
     * @method transform_areaMove
     * @param oldArea
     * @param newArea
     * @param oldIdx
     * @param newIdx
     */
    transform_areaMove:function (oldArea,newArea,oldIdx,newIdx) {
        var l1 = oldArea[0],l2 = newArea[0];
        var invalidValue = this.data.invalidValue;
        var dLat = l1.lat-l2.lat,dLng = l1.lng-l2.lng;
        var newGrid = [];
        var invaildItem = this.options.wind?[invalidValue,0]:invalidValue;
        this.eachItems(function(self, row, column){
            var latlng = self._getLatlngByRank(row,column);
            var s_latlng = L.latLng(latlng.lat+dLat,latlng.lng+dLng);
            var rank = self.getClosestGridByLatlng(s_latlng);
            if(Sun.Util.Geometry.latlngInPolygon(s_latlng,oldArea)){
                //前对照点在旧区域中，用改点的格点值覆盖新点
                var grid = self.inGrid(rank.row,rank.column)?self.grid[rank.row][rank.column]:invaildItem;
                newGrid.push([row,column,grid]);
            }
        },this,newIdx);
        for(var i=0;i<newGrid.length;i++){
            var item = newGrid[i];
            if(this.inGrid(item[0],item[1]))
                this.grid[item[0]][item[1]] = item[2];
        }
        this.eachItems(function(self, row, column){
            var latlng = self._getLatlngByRank(row,column);
            if(!Sun.Util.Geometry.latlngInPolygon(latlng,newArea))//前对照点不在新区域中，则改点变为无效值
                self.grid[row][column] = invaildItem;
        },this,oldIdx);

        this._fireTransform();
    },

    /**
     * 风向改变
     * @method transform_windDir
     * @param indexes {Array} 需要需要的索引
     * @param dir {number} 风向值
     */
    transform_windDir: function (indexes,dir) {
        if(!this.options.wind)
            return;
        var forFun = indexes == 'all' ? this.eachGrid: this.eachItems;
        forFun(function(self, row, column){
            var _grid = self.grid[row][column];
            if(!self.isHide(_grid)){
                var gValue = self._getValidValue(_grid);
                var wValue = Sun.Util.Weather.wind_getWindByUV(gValue);
                self.grid[row][column] = Sun.Util.Weather.wind_getUVByWind(wValue.speed, dir, 1, self.data.precision);
            }
        },this,indexes);
        this._fireTransform();
    },

    /**
     * 风向缓冲区
     * @method transform_windBuffer
     * @param indexes
     * @param trackData
     * @param map
     */
    transform_windBuffer: function (indexes,trackData,map) {
        if(!this.options.wind)
            return;
        var forFun = indexes == 'all' ? this.eachGrid: this.eachItems;
        forFun(function (self,row,column,idx) {
            var _grid = self.grid[row][column];
            if(self.isEditable(_grid,idx)){
                var gValue = self._getValidValue(_grid);
                var latlng = self._getLatlngByRank(row, column);
                var dir = getDir(latlng);
                var wValue = Sun.Util.Weather.wind_getWindByUV(gValue);
                self.grid[row][column] = Sun.Util.Weather.wind_getUVByWind(wValue.speed, dir, 1, self.data.precision);
            }
        },this,indexes);
        this._fireTransform();

        function getDir(gridLatlng) {
            var min_d=-1,min_i=-1;
            for(var i=0;i<trackData.length-1;i++){
                var l1 = trackData[i];
                var l2 = trackData[i+1];
                var l = L.latLng(l1.lat+(l2.lat-l1.lat)/2,l1.lng+(l2.lng-l1.lng)/2);
                var d = l.distanceTo(gridLatlng);
                if(min_d==-1 || d<min_d){
                    min_d = d;
                    min_i = i;
                }
            }
            if(min_i!=-1){
                var startP = map.latLngToContainerPoint(trackData[min_i]),
                    endP = map.latLngToContainerPoint(trackData[min_i+1]);
                var dir = Math.atan2(endP.y - startP.y, endP.x  - startP.x) * 180 / Math.PI - 90;
                return dir;
            }
        }
    }
});


LW.GridModelManager = L.Evented.extend({
    options:{
        wind:false,
        cover:true
    },

    initialize : function (options) {
        L.setOptions(this,options);
    },

    setData : function (source) {
        this.source = source;
        this.ncReader = new Sun.NCReader(new Uint8Array(source));
        this.data = Sun.Util.Data.changeGridNcToJson(this.ncReader);
        console.log(this.data);

        this.gridModels = {};
        this.areaLvlKeys = {area0:'',area1:'',area2:[]};
        for(var key in this.data.data){
            var item = this.data.data[key];
            var gridMdl = new LW.GridModel({dataType:"json",wind:this.options.wind});
            gridMdl.setData(item);
            this.gridModels[key] = gridMdl;

            if(item.dataLevel == 2)
                this.areaLvlKeys.area2.push(key);
            else{
                this.areaLvlKeys['area'+item.dataLevel] = key;
                if(item.dataLevel == 0)
                    this.bounds = gridMdl.bounds;
            }
        }
        var key0 = this.areaLvlKeys.area0;
        this.prefKey = key0.slice(0,key0.lastIndexOf('_')+1);

        if(this.options.cover)
            this._signCoverGrids();
        this.editedKeys=[];
        this._fireTransform();
    },

    getData:function () {
        var self = this;
        this.editedKeys.forEach(function (key) {
            if(self.options.wind){
                var uKey = key.replace('uv','u'),vKey = key.replace('uv','v');
                self.ncReader.setVariableAttribute(uKey,'DataChange',"1");
                self.ncReader.setVariableAttribute(vKey,'DataChange',"1");
            }
            else
                self.ncReader.setVariableAttribute(key,'DataChange',"1");
            self.gridModels[key].resetDataByGrid();
        });

        return this.ncReader.getNewBuffer(this.data,this.options.wind);
    },

    getKeyNo:function (key) {
        return key.slice(key.lastIndexOf('_')+1);
    },

    _fireTransform:function () {
        this.fire('transform');
    },

    // 标志重叠的格点
    _signCoverGrids:function () {
        var areaLvlKeys = this.areaLvlKeys,self = this;
        signGrid(areaLvlKeys.area0,areaLvlKeys.area1);
        this.areaLvlKeys.area2.forEach(function (item) {
            signGrid(areaLvlKeys.area1,item);
        });

        function signGrid(key_l,key_s) {
            var gridMdl_L = self.gridModels[key_l];
            var data = self.data.data[key_s];
            var bound = L.latLngBounds([[data.startlat-0.001,data.startlon]],[data.endlat,data.endlon]);
            var indexes = Sun.Util.Geometry.getGridInBounds(self.data.data[key_l],gridMdl_L.grid,bound);
            gridMdl_L.eachItems(function (self,row,column) {
                var value = gridMdl_L.grid[row][column];
                var latlng = gridMdl_L._getLatlngByRank(row,column);
                gridMdl_L.grid[row][column] = {covered:true,value:value,latlng:latlng,sGridKey:key_s};
            },gridMdl_L,indexes);
        }
    },

    getInterpolation:function(lat,lng){
        var lvlKeys = this.areaLvlKeys,gridModels = this.gridModels;
        for(var i=0;i<lvlKeys.area2.length;i++){
            var key = lvlKeys.area2[i];
            var gridModel = gridModels[key];
            if(contains(gridModel.bounds,lat,lng))
                return gridModel.getInterpolation(lat,lng);
        }
        var grid1 = gridModels[lvlKeys.area1];
        if(contains(grid1.bounds,lat,lng))
            return grid1.getInterpolation(lat,lng,valueFn);
        else{
            var grid0 = gridModels[lvlKeys.area0];
            return grid0.getInterpolation(lat,lng,valueFn);
        }

        function valueFn(grid) {
            return grid.covered ? getSGrid(grid) : grid;
        }

        function getSGrid(grid) {
            var model = gridModels[grid.sGridKey];
            var rank = model.getClosestGridByLatlng(grid.latlng);
            return model.getGrid(rank.row,rank.column);
        }

        function contains(bounds,lat, lng) {
            return (lat >= bounds.getSouth()) && (lat <= bounds.getNorth()) &&
                (lng >= bounds.getWest()) && (lng <= bounds.getEast());
        }
    },

    getGridData:function () {
        var grid = {isGrid:true,grid:{},editedKeys:this.editedKeys};
        for(var key in this.gridModels){
            var model = this.gridModels[key];
            grid.grid[key] = model.grid;
        }
        return grid;
    },

    resetGrid: function (grid,editedKeys) {
        this.editedKeys = editedKeys;
        for(var key in grid){
            var gridModel = this.gridModels[key];
            gridModel.resetGrid(grid[key]);
        }
        this._fireTransform();
    },


    getGridModel: function(key){
        return this.gridModels[this.prefKey+key];
    },

    /**
     * 获取某经纬度最近的网格
     * @method getClosestGridByLatlng
     * @param latlng {L.LatLng} 经纬度
     * @param leftbottom {boolean} [optional]
     * @returns {{row: number, column: number}}
     */
    getClosestGridByLatlng:function (latlng,leftbottom) {
        var self = this;
        if(self.data){
            var key,keys = this.areaLvlKeys.area2.concat([this.areaLvlKeys.area1,this.areaLvlKeys.area0]);
            for(var i=0;i<keys.length;i++){
                key = getKey(keys[i]);
                if(key) break;
            }
            if(key){
                var model = this.gridModels[key];
                var rank = model._getRankByLatlng(latlng);
                var mathFun = leftbottom ? 'floor' : 'round';
                var grid = {row:Math[mathFun](rank.row),column:Math[mathFun](rank.column)};
                grid.key = this.getKeyNo(key);
                return grid;
            }
        }

        function getKey(key) {
            var data = self.data.data[key];
            var bound = L.latLngBounds([[data.startlat,data.startlon]],[data.endlat+data.nlat,data.endlon+data.nlon]);
            return bound.contains(latlng) ? key : null;
        }
    },

    /**
     * 遍历指定的格点Item
     * @param fn
     * @param latlngs
     */
    eachGrid:function (fn,latlngs) {
        var self = this;
        for(var key in this.data.data){
            var item = this.data.data[key],bound;
            var model = self.gridModels[key],indexes=null;
            var keyNo = self.getKeyNo(key);
            if(latlngs.center && latlngs.radius){ // 圆形
                var center = latlngs.center, radius = latlngs.radius;
                var d1 = center.distanceTo([item.startlat,item.startlon]);
                var d2 = center.distanceTo([item.endlat,item.endlon]);
                if(d1<radius && d2<radius)
                    indexes = 'all';
                else{
                    bound = L.latLngBounds([item.startlat,item.startlon],[item.endlat,item.endlon]);
                    if(bound.intersects(latlngs.bounds) || bound.contains(latlngs.bounds))
                        indexes = Sun.Util.Geometry.getGridInCircle(model.data,model.grid,latlngs.bounds,center,radius,'index');
                }
            }
            else if(latlngs.bounds && latlngs.keys){
                if(latlngs.keys.indexOf(keyNo)!==-1)
                    indexes = 'all';
                else{
                    indexes = [];
                    var _indexes;
                    latlngs.bounds.forEach(function (bound) {
                        if(bound.keys.indexOf(keyNo)!==-1){//判断边界是否与这个网格有交集
                            _indexes = Sun.Util.Geometry.getGridInBounds(model.data,model.grid,bound.bound,'index');
                            indexes = indexes.concat(_indexes);
                        }
                    });
                    for(var i=0;i<latlngs.latlngs.length;i++){
                        var _latlngs = latlngs.latlngs[i];
                        _indexes = getIdxByLatlngs(item,model,_latlngs);
                        if(_indexes === 'all'){
                            indexes = _indexes;
                            break;
                        }
                        else if(_indexes)
                            indexes = indexes.concat(_indexes);
                    }
                }
            }
            else{ // 多边形
                indexes = getIdxByLatlngs(item,model,latlngs);
                // bound = [[item.startlat,item.startlon],[item.startlat,item.endlon],
                //     [item.endlat,item.endlon],[item.endlat,item.startlon]];
                // if(Sun.Util.Geometry.polygon1InPolygon2(bound,latlngs))
                //     indexes = 'all';
                // if(Sun.Util.Geometry.polygon1OverlapPolygon2(latlngs,bound)||Sun.Util.Geometry.polygon1InPolygon2(latlngs,bound))
                //     indexes = Sun.Util.Geometry.getGridsInPolygon(model.data,model.grid,latlngs,'index');
            }

            if(indexes) fn(indexes,key,model);
        }

        function getIdxByLatlngs(item,model,latlngs) {
            var bound = [[item.startlat,item.startlon],[item.startlat,item.endlon],
                [item.endlat,item.endlon],[item.endlat,item.startlon]];
            var idxes;
            if(Sun.Util.Geometry.polygon1InPolygon2(bound,latlngs))
                idxes = 'all';
            if(Sun.Util.Geometry.polygon1OverlapPolygon2(latlngs,bound)||Sun.Util.Geometry.polygon1InPolygon2(latlngs,bound))
                idxes = Sun.Util.Geometry.getGridsInPolygon(model.data,model.grid,latlngs,'index');
            return idxes;
        }
    },

    eachModel:function(fn){
        for(var key in this.gridModels){
            var model = this.gridModels[key];
            fn(model,this.getKeyNo(key));
        }
    },

    // 获取区域内的最大最小值
    getMinMaxOfGrids:function (latlngs) {
        var min,max;
        this.eachGrid(function (indexes,key,model) {
            var mValue = model.getMinMaxOfGrids(indexes);
            if(mValue.min<min || isNaN(min)) min = mValue.min;
            if(mValue.max>max || isNaN(max)) max = mValue.max;
        },latlngs);
        return {min:min,max:max};
    },

    /**
     * 应用指定经纬度最近的左下网格的变换，因为多网格的模型是按照左下对齐方式显示网格，而不是居中显示
     * @param latlng
     * @param selectValue {number} 选中的值
     */
    selectGrid: function(latlng,selectValue){
        var grid = this.getClosestGridByLatlng(latlng,true);
        var model = this.getGridModel(grid.key);
        var value = model.getGrid(grid.row,grid.column);
        value = value == selectValue ? this.data.invalidValue : selectValue ;
        model.transform_base([grid.row+'_'+grid.column],'equal',value);
        this._fireTransform();
    },

    /**
     * 变换
     * @param fn {String|Function} GridModel中的transform方法名：transform_base|transform_ratio|
     * @param latlngs {Array} 选择网格的经纬度
     * @param args {Array} GridModel中transform方法的参数
     * @param fireTransform {Boolean} 是否出发变换改变展示
     */
    transform:function (fn,latlngs,args,fireTransform) {
        var self = this;
        this.eachGrid(function (indexes,key,model) {
            var _args = [indexes].concat(args);
            typeof fn == 'function' ? fn.apply(model,_args) : model[fn].apply(model,_args);

            if(self.editedKeys.indexOf(key)==-1)
                self.editedKeys.push(key);
        },latlngs,args);
        if(typeof fireTransform=='undefined' || fireTransform)
            this._fireTransform();
    },

    transformByBoundsAndKey:function (fn,boundsAndKey,args) {
        var self = this,prefix = self.prefKey;
        boundsAndKey.keys.forEach(function (key) {
            key = prefix + key;
            var model = self.gridModels[key];
            var _args = ['all'].concat(args);
            model[fn].apply(model,_args);
            if(self.editedKeys.indexOf(key)==-1)
                self.editedKeys.push(key);
        });
        boundsAndKey.bounds.forEach(function (bounds) {
            var keys = bounds.keys.map(function (key) {return prefix + key;});
            var editKeys = keys.concat([self.areaLvlKeys.area0,self.areaLvlKeys.area1]);
            editKeys.forEach(function (key) {
                var model = self.gridModels[key];
                var indexes = Sun.Util.Geometry.getGridInBounds(model.data,model.grid,bounds.bound,'index');
                var _args = [indexes].concat(args);
                model[fn].apply(model,_args);

                if(self.editedKeys.indexOf(key)==-1)
                    self.editedKeys.push(key);
            })
        });
        if(boundsAndKey.latlngs){
            boundsAndKey.latlngs.forEach(function (latlngs) {
                self.transform(fn,latlngs,args,false);
            });
        }
        this._fireTransform();
    },

    getIndexesByBoundsAndKey:function (boundsAndKey) {
        var self = this,prefix = self.prefKey;
        boundsAndKey.keys.forEach(function (key) {
            key = prefix + key;
            var model = self.gridModels[key];
            var _args = ['all'].concat(args);
            model[fn].apply(model,_args);
            if(self.editedKeys.indexOf(key)==-1)
                self.editedKeys.push(key);
        });
        boundsAndKey.bounds.forEach(function (bounds) {
            var keys = bounds.keys.map(function (key) {return prefix + key;});
            var editKeys = keys.concat([self.areaLvlKeys.area0,self.areaLvlKeys.area1]);
            editKeys.forEach(function (key) {
                var model = self.gridModels[key];
                var indexes = Sun.Util.Geometry.getGridInBounds(model.data,model.grid,bounds.bound,'index');
                var _args = [indexes].concat(args);
                model[fn].apply(model,_args);

                if(self.editedKeys.indexOf(key)==-1)
                    self.editedKeys.push(key);
            })
        });
        if(boundsAndKey.latlngs){
            boundsAndKey.latlngs.forEach(function (latlngs) {
                self.transform(fn,latlngs,args,false);
            });
        }
    }
});

/*
 * Lambert projection
 * EPSG:24600.
 */
L.Projection.Lambert = {
    lon0: 110 / 180 * Math.PI, // lon0,lat0为投影坐标(0,0)对应的经纬值,lon0投影意义为垂直经线
    lat0: 30 / 180 * Math.PI,
    lat1: 30 / 180 * Math.PI, // 第一纬度
    lat2: 60 / 180 * Math.PI, // 第二纬度

    bounds: L.bounds([0, -1], [360, 180]),

    create: function () {

        this.n = Math.log(Math.cos(this.lat1) / Math.cos(this.lat2)) /
            Math.log(Math.tan(Math.PI / 4 + this.lat2 / 2) / Math.tan(Math.PI / 4 + this.lat1 / 2));
        this.f = Math.cos(this.lat1) * Math.pow(Math.tan(Math.PI / 4 + this.lat1 / 2), this.n) / this.n;
        this.r0 = this.f / Math.pow(Math.tan(Math.PI / 4 + this.lat0 / 2), this.n);

        return this;
    },

    project: function (latlng) {
        var p = L.point(Math.PI * latlng.lng / 180, Math.PI * latlng.lat / 180);
        var r = this.f / Math.pow(Math.tan(Math.PI / 4 + p.y / 2), this.n);

        var x = r * Math.sin(this.n * (p.x - this.lon0));
        var y = r * Math.cos(this.n * (p.x - this.lon0)) - this.r0;

        return new L.Point(x, y);
    },

    unproject: function (point) {
        var n1;
        if (this.n < 0)
            n1 = -1;
        else if (this.n == 0)
            n1 = 0;
        else
            n1 = 1;

        var r = n1 * Math.sqrt(point.x * point.x + (this.r0 + point.y) * (this.r0 + point.y));
        var w = Math.atan2(point.x, this.r0 + point.y);

        var x = this.lon0 + w / this.n;
        var y = 2 * Math.atan(Math.pow(this.f / r, 1 / this.n)) - 0.5 * Math.PI;

        return new L.LatLng(180 * y / Math.PI, 180 * x / Math.PI);
    }
};

/**
 * 地理信息
 * @module Geo
 */

/**
 * L.CRS.EPSG24600
 *
 * Features :
 *      1. 兰伯特投影的crs
 *      2. 用法：map配置属性：{crs: L.CRS.EPSG24600}
 *      3. 瓦片图层需配置属性：{noWrap: true}
 *
 * @class L.CRS.EPSG24600
 * @extends L.CRS.Earth
 */

L.CRS.EPSG24600 = L.extend({}, L.CRS.Earth, {
    code: 'EPSG:24600',
    projection: L.Projection.Lambert.create(),

    transformation: (function () {
        // 1/256*64=0.25
        return new L.Transformation(0.25, 0, 0.25, 0);
    }())
});

/**
 * Created by whl on 2015/9/18.
 */
LW.LabelIcon = L.Icon.extend({
    options: {
        iconSize: new L.Point(40, 18),
        color: '#000',
        fontSize: '12px',
        textAlign:'center',
        edge: true,
        bold: false,
        pointerEvents:'none',
        fontFamily:'Microsft YaHei',
        className:''
    },

    label: null,

    getIcon: function () {
        return this.label;
    },

    createIcon: function () {
        this.label = L.DomUtil.create('p', this.options.className);
        this.label.style.color = this.options.color;
        this.label.style.fontSize = this.options.fontSize;
        this.label.style.fontFamily = this.options.fontFamily;
        this.label.style.width = this.options.iconSize.x + 'px';
        this.label.style.textAlign = this.options.textAlign;
        this.label.style.pointerEvents = this.options.pointerEvents;
        this.label.style.lineHeight = this.options.iconSize.y + 'px';
        if (this.options.bold)
            this.label.style.fontWeight = 'bold';
        if (this.options.edge)
            this.label.style.textShadow = '1px 0px 0px #fff,-1px 0px 0px #fff,0px 1px 0px #fff,0px -1px 0px #fff';

        this._setIconStyles(this.label, "icon");
        return this.label;
    },

    _setIconStyles: function (img, name) {
        var options = this.options,
            size = L.point(options[name + 'Size']),
            anchor = L.point(name === 'shadow' && options.shadowAnchor || options.iconAnchor ||
                size && size.divideBy(2, true));

        img.className = 'leaflet-marker-' + name + ' ' + (options.className || '');

        if (anchor) {
            img.style.marginLeft = (-anchor.x) + 'px';
            img.style.marginTop  = (-anchor.y) + 'px';
        }
    },

    setData: function (value, rotation) {
        this.label.innerText = String(value);
        this.rotation = rotation;
        this.setRotation();
    },

    setStyle: function (style) {
        for(var key in style){
            this.options[key] = style[key];
            this.label.style[key] = style[key];
        }
    },

    setRotation: function () {
        if (this.rotation) {
            var rotation = this.rotation;
            var size = this.options.iconSize;
            rotation = rotation < -90 || rotation > 90 ? rotation + 180 : rotation;
            this.label.style.transform += "translate(" + size.x / 2 + "px," + size.y / 2 + "px)";
            this.label.style.transform += "rotate(" + rotation + "deg)";
            this.label.style.transform += "translate(" + -size.x / 2 + "px," + -size.y / 2 + "px)";
        }

        //this.label.style.msTransform += "rotate(" + rotation + "deg)";
        //this.label.style.webkitTransform += "rotate(" + rotation + "deg)";
        //this.label.style.MozTransform += "rotate(" + rotation + "deg)";
        //this.label.style.OTransform += "rotate(" + rotation + "deg)";
    },
    setLabelVisible: function (visible) {
        this.label.style.display = visible ? 'block' : 'none';
    }
});

/**
 * name icon
 * 带有名字的Icon
 */
LW.NameIcon = L.Icon.extend({

    options: {
        radius: 2,
        color: '#fff',
        iconSize: new L.Point(60, 50),
        iconType: 'image',//(image/graph/dyImage)
        strokeColor: '#333'
        //dyImageUrlFun:'' /*动态图片取地址Function*/
        //nameLabelClass:''
        //imageSize: new L.Point(25, 25)
    },

    container: null,
    dot: null,
    nameLabel: null,

    getIcon: function () {
        return this.container;
    },

    createIcon: function (oldIcon) {
        this.container = document.createElement('div');
        if (this.options.iconType == 'image' || this.options.iconType == 'dyImage') {
            this.dot = document.createElement("img");
            if (this.options.iconType == 'image')
                this.dot.src = this.options.iconUrl;
        } else
            this.dot = document.createElement("canvas");
        this.container.appendChild(this.dot);
        this._createLabel();
        this._setIconStyles(this.container, "icon");
        this._setStyle();
        this._setLabelStyle();
    },
    _createLabel: function () {
        this.nameLabel = document.createElement("p");
        this.container.appendChild(this.nameLabel);
    },

    _setStyle: function () {
        var iconSize = this.options.iconSize;
        if (this.options.iconType == 'graph') {
            this.dot.width = iconSize.x;
            this.dot.height = iconSize.y;
        }
        else {//图片布局
            if (this.options.imageSize) {
                this.dot.width = this.options.imageSize.x;
                this.dot.height = this.options.imageSize.y;
                Sun.Util.Layout.center(this.dot, iconSize.x, iconSize.y);
            }
            else {
                if (this.dot.complete)
                    Sun.Util.Layout.center(this.dot, iconSize.x, iconSize.y);
                else {
                    this.dot.onload = function (e) {
                        Sun.Util.Layout.center(e.target, iconSize.x, iconSize.y);
                    };
                }
            }
        }
    },
    _setLabelStyle: function () {
        this.nameLabel.className = this.options.nameLabelClass;
        this.nameLabel.style.width = this.options.iconSize.x;
        this.nameLabel.style.textAlign = 'center';
    },

    _drawDot: function () {
        var ctx = this.dot.getContext("2d");
        var w = this.options.iconSize.x;
        var h = this.options.iconSize.y;
        if (!ctx) return;
        ctx.clearRect(0,0,w,h);
        ctx.beginPath();
        ctx.fillStyle = this.options.color;
        ctx.strokeStyle = this.options.strokeColor;
        ctx.lineWidth = 1;
        var radius = this.options.radius;
        ctx.arc(w / 2, h / 2, radius, 0, Math.PI * 2, false);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    },

    reDrawDot: function (color) {
        if (this.options.iconType == 'graph') {
            var ctx = this.dot.getContext("2d");
            var w = this.options.iconSize.x;
            var h = this.options.iconSize.y;
            if (!ctx) return;
            ctx.clearRect(0, 0, w, h);
            this.options.color = color;
            this._drawDot();
        }
    },

    setData: function (data, stationName) {
        this.nameLabel.innerText = stationName ? stationName : '';
        if (this.options.iconType == 'dyImage') {
            this.dot.src = this.options.dyImageUrlFun(data);
            this._setStyle();
        }
        else if (this.options.iconType == 'graph')
            this._drawDot();
    },

    setNameLabelVisible: function (visible) {
        this.nameLabel.style.display = visible ? 'block' : 'none';
    }
});

/**
 * value icon
 * 带有值的Icon
 */
LW.ValueIcon = LW.NameIcon.extend({

    options: {
        iconType: 'graph',//(image/graph/dyImage)
        //valueLabelClass:''
        codeLabelClass: '',
        codeLabelVisible: false
    },

    valueLabel: null,
    codeLabel: null,

    _createLabel: function () {
        this.valueLabel = document.createElement("p");
        this.container.appendChild(this.valueLabel);
        this.nameLabel = document.createElement("p");
        this.container.appendChild(this.nameLabel);
        this.codeLabel = document.createElement("p");
        this.container.appendChild(this.codeLabel);
    },
    _setLabelStyle: function () {
        this.valueLabel.style.height = '18px';
        this.valueLabel.className = this.options.valueLabelClass;
        this.valueLabel.style.width = this.options.iconSize.x;
        this.valueLabel.style.textAlign = 'center';

        this.nameLabel.className = this.options.nameLabelClass;
        this.nameLabel.style.width = this.options.iconSize.x;
        this.nameLabel.style.textAlign = 'center';

        if (this.codeLabel) {
            this.codeLabel.className = this.options.codeLabelClass;
            this.codeLabel.style.width = this.options.iconSize.x;
            this.codeLabel.style.textAlign = 'center';
            this.codeLabel.style.visibility = this.options.codeLabelVisible ? 'visible' : 'hidden';
        }
    },

    setData: function (stationName, value, code) {
        this.valueLabel.innerText = value == null || isNaN(value) || value ==0 ? '  ' : value;
        this.nameLabel.innerText = stationName;
        this.codeLabel.innerText = code == null || code == undefined ? ' ' : code;
        if (this.options.iconType == 'dyImage') {
            this.dot.src = this.options.dyImageUrlFun(value);
            this._setStyle();
        }
        else if (this.options.iconType == 'graph')
            this._drawDot();
    },

    setValueLabelVisible: function (visible) {
        this.valueLabel.style.visibility = visible ? 'visible' : 'hidden';
    },

    setNameLabelVisible: function (visible) {
        this.nameLabel.style.display = visible ? 'block' : 'none';
        this.codeLabel.className = visible ? this.options.codeLabelClass : this.options.nameLabelClass;
    },

    setCodeLabelVisible: function (visible) {
        this.codeLabel.style.visibility = visible ? 'visible' : 'hidden';
    },

    setStyle: function (style,type) {
        if(type == 'radius'){
            this.options.radius = style;
            this._drawDot();
        }
        else{
            var label = type=='name'?this.nameLabel:this.valueLabel;
            for(var key in style){
                label.style[key] = style[key];
            }
        }
    }
});

/**
 * base zdz wind icon
 * 基础自动站风Icon
 */
LW.BaseZdzWindIcon = LW.ValueIcon.extend({
    options: {
        radius: 2,
        windVaneWidth: 1,
        windVaneColor: '#000',
        windVaneLength: 32,
        iconSize: new L.Point(80, 60)
        //windDirection: 0,
        //windSpeed: 0
    },
    canvas: null,

    createIcon: function (oldIcon) {
        this.container = document.createElement('div');
        this.dot = document.createElement("canvas");
        this.container.appendChild(this.dot);
        if (this.options.iconType == 'image') {
            this.img = document.createElement("img");
            this.img.src = this.options.iconUrl;
            this.container.appendChild(this.img);
        }
        this._createLabel();
        this._setIconStyles(this.container, "icon");
        this._setStyle();
        this._setLabelStyle();
        return this.container;
    },
    _setStyle: function () {
        var iconSize = this.options.iconSize;

        this.dot.width = iconSize.x;
        this.dot.height = iconSize.y;
        if (this.options.iconType == 'image') {//图片布局
            if (this.options.imageSize) {
                this.img.width = this.options.imageSize.x;
                this.img.height = this.options.imageSize.y;
            }
            if (this.img.complete) {
                Sun.Util.Layout.center(this.img, iconSize.x, iconSize.y);
            }
            else {
                this.img.onload = function (e) {
                    Sun.Util.Layout.center(e.target, iconSize.x, iconSize.y);
                };
            }
        }
    },
    _drawWind: function () {
        var ctx = this.dot.getContext("2d");
        var w = this.options.iconSize.x;
        var h = this.options.iconSize.y;
        if (!ctx) return;
        if (this.options.windSpeed == 0 || this.options.windDirection == 0) return;
        ctx.lineWidth = this.options.windVaneWidth;
        ctx.strokeStyle = this.options.windVaneColor;
        Sun.Util.Geometry.drawWind(ctx, this.options.windSpeed, this.options.windDirection, w, h, this.options.windVaneLength);
    },

    setData: function (stationName, windSpeed, windDirection, code) {
        this.valueLabel.innerText = (windSpeed == null || windSpeed == 999.9) ? ' ' : windSpeed;
        this.nameLabel.innerText = stationName;
        this.codeLabel.innerText = code == null || code == undefined ? ' ' : code;
        if (this.options.iconType == 'graph')
            this._drawDot();
        this._setWindData(windSpeed, windDirection);
    },

    _setWindData: function (windSpeed, windDirection, stationName) {
        //this.options.windDirection = (windDirection % 360) - (11.25 % 360);
        this.options.windDirection = windDirection;
        this.options.windSpeed = windSpeed;
        this._drawWind();
    },

    setStyle: function (style,type) {
        if(type == 'radius'){
            this.options.radius = style;
            this._drawDot();
            this.options.windDirection = 360;//Tip:重新绘制后似乎会记住上次rotate且网上增加，所以把这个设为360
            this._drawWind();
        }
        else{
            var label = type=='name'?this.nameLabel:this.valueLabel;
            for(var key in style){
                label.style[key] = style[key];
            }
        }
    }
});

/**
 * synthetical zdz icon
 * 自动站综合填图Icon
 */
LW.SynZdzIcon = LW.BaseZdzWindIcon.extend({
    options: {
        iconSize: new L.Point(80, 80),
        iconType: 'image'
    },

    valueLabelLeft: null,
    valueLabelRight: null,

    _createLabel: function () {
        this.valueLabel = document.createElement("p");
        this.container.appendChild(this.valueLabel);

        this.valueLabelLeft = document.createElement("p");
        this.container.appendChild(this.valueLabelLeft);

        this.valueLabelRight = document.createElement("p");
        this.container.appendChild(this.valueLabelRight);

        this.nameLabel = document.createElement("p");
        this.container.appendChild(this.nameLabel);
    },
    _setAroundLabelStyle: function () {
        this.valueLabel.style.color = '#000';
        this.valueLabelLeft.className = this.options.valueLabelClass;
        this.valueLabelLeft.style.color = '#000';
        this.valueLabelLeft.style.position = 'absolute';
        this.valueLabelLeft.style.top = '18px';
        this.valueLabelLeft.style.right = this.options.iconSize.x / 2 + 8 + 'px';
        this.valueLabelRight.className = this.options.valueLabelClass;
        this.valueLabelRight.style.color = '#000';
        this.valueLabelRight.style.position = 'absolute';
        this.valueLabelRight.style.top = '18px';
        this.valueLabelRight.style.left = this.options.iconSize.x / 2 + 8 + 'px';
    },

    setData: function (stationName, value, valueLeft, valueRight, windSpeed, windDirection) {
        this.valueLabel.innerText = Sun.Util.isValid(value) ? value : '  ';
        this.valueLabelLeft.innerText = Sun.Util.isValid(valueLeft) ? valueLeft : '  ';
        this.valueLabelRight.innerText = Sun.Util.isValid(valueRight) ? valueRight : '  ';
        this.nameLabel.innerText = stationName;
        if (this.options.iconType == 'graph')
            this._drawDot();
        if (windSpeed && windDirection)
            this._setWindData(windSpeed, windDirection);
        this._setAroundLabelStyle();
    },

    setValueLabelLeftVisible: function (visible) {
        this.valueLabelLeft.style.visibility = visible;
    },

    setValueLabelRightVisible: function (visible) {
        this.valueLabelRight.style.visibility = visible;
    }
});

/**
 * water level icon
 * 水位Icon
 */
LW.WaterLevelIcon = LW.ValueIcon.extend({
    options: {
        imageSize: new L.Point(20, 20),
        iconSize: new L.Point(120, 60)
    },

    statusContainer: null,
    dot2: null,

    createIcon: function (oldIcon) {
        this.container = document.createElement('div');
        this.statusContainer = document.createElement('div');
        this.container.appendChild(this.statusContainer);
        this.dot = document.createElement("img");
        this.statusContainer.appendChild(this.dot);
        this.dot2 = document.createElement("img");
        this.statusContainer.appendChild(this.dot2);
        this._createLabel();
        this._setIconStyles(this.container, "icon");
        this._setStyle();
        this._setLabelStyle();
    },
    _setStyle: function () {
        var iconSize = this.options.iconSize;
        this.dot.width = this.options.imageSize.x;
        this.dot.height = this.options.imageSize.y;
    },
    _setWaterStatusStyle: function () {
        this.statusContainer.width = this.dot.width + this.dot2.width;
        this.statusContainer.height = this.options.imageSize.y;
        Sun.Util.Layout.center(this.statusContainer, this.options.iconSize.x, this.options.iconSize.y);
    },
    setData: function (stationName, value, limitStatus, changedStatus) {
        this.valueLabel.innerText = value == null || isNaN(value) ? '  ' : value;
        this.nameLabel.innerText = stationName;
        this.dot.src = this.options.iconUrl + limitStatus + '.png';
        if (changedStatus != WaterlevelStatus.NONE) {
            this.dot2.width = this.options.imageSize.x;
            this.dot2.height = this.options.imageSize.y;
            this.dot2.src = this.options.iconUrl + changedStatus + '.png';
        }
        this._setWaterStatusStyle();
    }
});


/**
 * Created by whl on 2015/9/18.
 */

LW.BaseMarker = L.Marker.extend({

    initialize: function (latlng, options) {
        L.setOptions(this, options);
        this._latlng = L.latLng(latlng);
        options.icon.createIcon(this._icon);
    },

    _initIcon: function () {
        var options = this.options,
            classToAdd = 'leaflet-zoom-' + (this._zoomAnimated ? 'animated' : 'hide');


        var icon = options.icon.getIcon(),
            addIcon = false;

        // if we're not reusing the icon, remove the old one and init new one
        if (icon !== this._icon) {
            if (this._icon) {
                this._removeIcon();
            }
            addIcon = true;

            if (options.title) {
                icon.title = options.title;
            }
            if (options.alt) {
                icon.alt = options.alt;
            }
        }

        L.DomUtil.addClass(icon, classToAdd);

        if (options.keyboard) {
            icon.tabIndex = '0';
        }

        this._icon = icon;

        if (options.riseOnHover) {
            this.on({
                mouseover: this._bringToFront,
                mouseout: this._resetZIndex
            });
        }

        var newShadow = options.icon.createShadow(this._shadow),
            addShadow = false;

        if (newShadow !== this._shadow) {
            this._removeShadow();
            addShadow = true;
        }

        if (newShadow) {
            L.DomUtil.addClass(newShadow, classToAdd);
        }
        this._shadow = newShadow;


        if (options.opacity < 1) {
            this._updateOpacity();
        }


        if (addIcon) {
            this.getPane().appendChild(this._icon);
            this._initInteraction();
        }
        if (newShadow && addShadow) {
            this.getPane('shadowPane').appendChild(this._shadow);
        }
    }
});

/**
 * 纯文本 Marker
 * 支持设置旋转角度
 */
LW.LabelMarker = LW.BaseMarker.extend({

    /**
     * 设置文本值
     * @param value 值
     * @param rotation 旋转角度
     * @returns {L.LabelMarker}
     */
    setData: function (value, rotation) {
        this.value = value;
        this.options.icon.setData(value, rotation);
        return this;
    },
    _setPos: function (pos) {
        L.DomUtil.setPosition(this._icon, pos);
        this.options.icon.setRotation();

        this._zIndex = pos.y + this.options.zIndexOffset;

        this._resetZIndex();
    },
    setLabelVisible: function (visible) {
        this.options.icon.setLabelVisible(visible);
    },
    getValueInvalidity: function () {
        return (this.value == null || isNaN(this.value));
    }
});

LW.labelMarker = function (latlng, options) {
    if (!options) options = {};
    options.icon = options.icon || new LW.LabelIcon(options.iconOptions);
    return new LW.LabelMarker(latlng, options);
};

/**
 * name Marker
 * 带有名字的Marker
 */
LW.NameMarker = LW.BaseMarker.extend({
    options: {
        nameField: 'STATIONNAME'
    },
    data: null,

    setData: function (data) {
        this.data = data;
        var nameText = data[this.options.nameField];
        this.options.icon.setData(data, nameText);
    },

    reDrawDot: function (color) {
        this.options.icon.reDrawDot(color);
    },

    setNameLabelVisible: function (visible) {
        this.options.icon.setNameLabelVisible(visible);
    }

});

LW.nameMarker = function (latlng, options) {
    if (!options) options = {};
    options.icon = options.icon || new LW.NameIcon(options.iconOptions);
    return new LW.NameMarker(latlng, options);
};

/**
 * value Marker
 * 带有值的Marker
 */
LW.ValueMarker = LW.NameMarker.extend({
    options: {
        //valueField: '',
        //scale:1,
        codeField: 'STATIONCODE',
        legendData: null,
        invalidValue: ''
    },

    value: null,

    setData: function (data,dataField) {
        this._setData(data,dataField);
        this.options.icon.options.color = Sun.Util.LegendData.getColorOfRangeLegend(this.options.legendData, this.value);
        this.options.icon.setData(this.nameText, this.value, this.code);
    },

    _setData: function (data,dataField) {
        this.data = data;
        this.dataField = dataField;
        var value = Sun.Util.Data.getValueByField(data,this.options.valueField,dataField);
        this.nameText = Sun.Util.Data.getValueByField(data,this.options.nameField,dataField);
        this.code = Sun.Util.Data.getValueByField(data,this.options.codeField,dataField);
        if (this.options.scale && value != null) {
            value = String(value * this.options.scale);
            value = parseFloat(value.substr(0, value.indexOf(".") + 4));
        }
        this.value = value;
    },

    getValueInvalidity: function (value) {
        value = value || this.value;
        return (value == null || isNaN(value) || value == this.options.invalidValue);
    },

    setValueLabelVisible: function (visible) {
        this.options.icon.setValueLabelVisible(visible);
    },

    setCodeLabelVisible: function (value) {
        this.options.icon.setCodeLabelVisible(value);
    }
});

LW.valueMarker = function (latlng, options) {
    if (!options) options = {};
    options.icon = options.icon || new LW.ValueIcon(options.iconOptions);
    return new LW.ValueMarker(latlng, options);
};

/**
 * base zdz wind marker
 * 基础自动站风Marker
 */
LW.BaseZdzWindMarker = LW.ValueMarker.extend({
    options: {
        dirField: ''
    },
    setData: function (data,dataField) {
        this._setData(data,dataField);
        this.options.icon.options.color = Sun.Util.LegendData.getColorOfRangeLegend(this.options.legendData, this.value);
        if (this.value > 10.8) {
            this.options.icon.options.windVaneWidth = 2;
            this.options.icon.options.windVaneColor = this.options.icon.options.color;
        }
        this.options.icon.setData(this.nameText, this.value, this.dir,this.code);
    },

    _setData:function (data,dataField) {
        LW.ValueMarker.prototype._setData.call(this,data,dataField);
        this.dir = Sun.Util.Data.getValueByField(data,this.options.dirField,dataField);
    }
});
LW.baseZdzWindMarker = function (latlng, options) {
    if (!options) options = {};
    options.icon = options.icon || new LW.BaseZdzWindIcon(options.iconOptions);
    return new LW.BaseZdzWindMarker(latlng, options);
};

LW.SynZdzMarker = LW.BaseZdzWindMarker.extend({
    options: {
        windSpeedField: '',
        valueLeftField: '',
        valueRightField: ''
    },
    setData: function (data) {
        this.options.icon.setData(data[this.options.nameField], data[this.options.valueField],
            data[this.options.valueLeftField], data[this.options.valueRightField],
            data[this.options.windSpeedField], data[this.options.dirField]);
    },

    resetLabelField: function (valueField, valueLeftField, valueRightField, windSpeedField, dirField) {
        this.options.valueField = valueField;
        this.options.valueLeftField = valueLeftField;
        this.options.valueRightField = valueRightField;
        this.options.windSpeedField = windSpeedField;
        this.options.dirField = dirField;
    },

    setValueLabelLeftVisible: function (visible) {
        this.options.icon.setValueLabelLeftVisible(visible);
    },

    setValueLabelRightVisible: function (visible) {
        this.options.icon.setValueLabelRightVisible(visible);
    }
});

LW.synZdzMarker = function (latlng, options) {
    if (!options) options = {};
    options.icon = options.icon || new LW.SynZdzIcon(options.iconOptions);
    return new LW.SynZdzMarker(latlng, options);
};

LW.WaterLevelMarker = LW.ValueMarker.extend({
    setData: function (currentData, historyData) {
        this.data = currentData;
        var nameText = currentData[this.options.nameField];
        var value = currentData[this.options.valueField];
        var limitStatus = Sun.Util.Weather.waterLevel_getLimitStatus(currentData);
        var changedStatus = Sun.Util.Weather.waterLevel_getLimitStatus(currentData, historyData);
        this.options.icon.setData(nameText, value, limitStatus, changedStatus);
    }
});

LW.waterLevelMaker = function (latlng, options) {
    if (!options) options = {};
    options.icon = options.icon || new LW.WaterLevelIcon(options.iconOptions);
    return new LW.WaterLevelMarker(latlng, options);
};


/**
 * 基础图层
 *
 * Features :
 *      1. 含自动站、预警信号、雷达、云图等基础图层
 *
 * @module Layer.Base
 */

/**
 * 基础图层
 * Features :
 *      1. 默认为带名字的marker图层，可通过重设markerInstance改变marker实例
 *      2. 含有边界切割功能，在地图外的marker不显示
 *
 * Update Note：
 *      + v1.0.0 ：Created
 *      + v1.0.4 ：增加图层未添加在地图上仍可设置数据的功能
 *      + v1.0.4-dev ：移除markerClickMode属性，移除addEventParent方法
 *
 * @class LW.BaseLayer
 * @extends L.FeatureGroup
 *
 * @demo demo/base/base.html  {基于基础图层的地灾图层}
 */
LW.BaseLayer = L.FeatureGroup.extend({
    options: {
        /**
         * 纬度字段名
         * @property latField
         * @type {string}
         * @default 'LAT'
         */
        latField: 'LAT',

        /**
         * 经度字段名
         * @property lonField
         * @type {string}
         * @default 'LON'
         */
        lonField: 'LON',

        /**
         * Marker 实例
         * @property markerInstance
         * @type {function}
         * @default LW.nameMarker
         */
        markerInstance: LW.nameMarker,

        /**
         * Marker's id 字段名
         * @property markerIdField
         * @type {string}
         * @default 'STATIONCODE'
         */
        markerIdField: 'STATIONCODE',

        gradingModel:null,

        /**
         * icon 's options
         * @property iconOptions
         * @type {object}
         */
        iconOptions: {},

        pane: 'markerPane'
    },

    nameLabelVisible: true,

    initialize: function (options, layers) {
        this._layers = {};

        var i, len;

        if (layers) {
            for (i = 0, len = layers.length; i < len; i++) {
                this.addLayer(layers[i]);
            }
        }

        L.setOptions(this, options);
    },

    onAdd: function (map) {
        this._map = map;
        if (this.data)
            this.setData(this.data);
        map.on("zoomend", this._onMapChanged, this);
        map.on("moveend", this._onMapChanged, this);
    },

    onRemove: function (map) {
        map.off("zoomend", this._onMapChanged, this);
        map.off("moveend", this._onMapChanged, this);
        L.LayerGroup.prototype.onRemove.call(this, map);
    },

    _onMapChanged: function () {
        this.eachLayer(this._onMarkerShowHide, this);
    },

    _onMarkerShowHide: function (layer) {
        var map = this._map;
        if (null != map) {
            var zoom = map.getZoom(),
                minzoom = layer.options.minZoom || 0,
                maxzoom = layer.options.maxZoom || 18;
            if (zoom >= minzoom && zoom <= maxzoom && map.getBounds().contains(layer.getLatLng())) {
                if (!map.hasLayer(layer))
                    map.addLayer(layer);
            }
            else {
                map.removeLayer(layer);
            }

        }
    },

    /**
     * 设置图层数据，并创建数据对应的Marker，加到图层上
     * @method setData
     * @param data {Array}
     */
    setData: function (data) {
        this.clearLayers();
        if(this.options.gradingModel && data && data.length>0){
            this.options.gradingModel.setData(data);
            data = this.options.gradingModel.getData(18);
        }
        this.data = data;
        if (this._map) {
            this._setData(data);
            this._onMapChanged();
            this.eachLayer(this._setMarkerLabelStatus, this);
        }
        return this;
    },

    /**
     * 遍历数据，创建Markers
     * @protected
     * @param source {Array}
     */
    _setData: function (source) {
        var data = source.FieldName?source.Rows:source;
        for (var i = 0; i < data.length; i++) {
            var o = data[i];
            var options = Sun.Util.Data.clone(this.options);
            var lat = Sun.Util.Data.getValueByField(o,options.latField,source.FieldName);
            var lng = Sun.Util.Data.getValueByField(o,options.lonField,source.FieldName);
            if (lat != '' && lng != '') {
                if(o.minZoom) options.minZoom = o.minZoom;
                var m = options.markerInstance([lat, lng], options);
                m.id = o[options.markerIdField];
                m.addTo(this).setData(o,source.FieldName);
            }
        }
    },

    /**
     * 通过ID获取Maker
     * @method getMarkerById
     * @param id 注：options.markerIdField设置的字段的对应值为id
     * @returns {*}
     */
    getMarkerById: function (id) {
        for (var i in this._layers) {
            if (this._layers[i].id == id)
                return this._layers[i];
        }
    },

    _setMarkerLabelStatus: function (m) {
        if (!this.nameLabelVisible)
            m.setNameLabelVisible(this.nameLabelVisible);
    },

    /**
     * 设置名称文本(name label)的显隐
     * @method setNameLabelVisible
     * @param visible {boolean}
     */
    setNameLabelVisible: function (visible) {
        this.nameLabelVisible = visible;
        var setMarkerNameVisible = function (marker) {
            if (marker instanceof LW.NameMarker)
                marker.setNameLabelVisible(visible);
        };
        this.eachLayer(setMarkerNameVisible, this);
        return this;
    },

    setStyle:function (style,type) {
        if(typeof style == 'object'){
            for(var key in style){
                this.options.iconOptions[key] = style[key];
            }
        }
        else
            this.options.iconOptions[type] = style;

        this.eachLayer(function (m) {
            m.options.icon.setStyle(style,type);
        },this)
    }
});

/**
 *
 * @class LW.BaseLayer
 * @constructor
 * @param options {object} 外部属性，可重设Properties
 * @param layers {object} 初始图层，可以不传
 * @returns {LW.BaseLayer}
 */
LW.baseLayer = function (options, layers) {
    return new LW.BaseLayer(options, layers);
};

/**
 * 文本图层--县名、市名等图层
 * @class LW.LabelLayer
 * @extends LW.BaseLayer
 */
LW.LabelLayer = LW.BaseLayer.extend({
    options: {
        /**
         * marker name 字段名
         * @property nameField
         * @default 'NAME'
         */
        nameField: 'NAME',

        /**
         * marker location 字段名
         * @property locationField
         * @default 'LOCATION'
         */
        locationField: 'LOCATION',

        /**
         * Marker 实例
         * @property markerInstance
         * @default LW.labelMarker
         */
        markerInstance: LW.labelMarker,

        minZoom: 0,
        maxZoom: 18
    },


    // onAdd: function (map) {
    //     L.LayerGroup.prototype.onAdd.call(this, map);
    // },
    //
    // onRemove: function (map) {
    //     L.LayerGroup.prototype.onRemove.call(this, map);
    // },

    setData: function (data) {
        this.clearLayers();
        this.data = data;
        this._setData(data);
        return this;
    },

    _setData: function (data) {
        for (var i = 0; i < data.length; i++) {
            var o = data[i];
            var options = Sun.Util.Data.clone(this.options);
            var location = o[options.locationField][0];
            var m = this.options.markerInstance([location[1], location[0]], options);
            var name = o[options.nameField];
            m.addTo(this).setData(name);
            m.data = o;
            m.id = name.slice(0, 2);
        }
    }
});

LW.labelLayer = function (options, layers) {
    return new LW.LabelLayer(options, layers);
};

/**
 * 基础自动站图层
 * @class LW.BaseZdzLayer
 * @extends LW.BaseLayer
 *
 * @demo demo/base/zdzInstances.js {自动站--实例}
 * @demo demo/base/zdzWind.html {自动站--风图层}
 */
LW.BaseZdzLayer = LW.BaseLayer.extend({
    options: {
        /**
         * 设置icon options，将在创建icon时复制传入，可设置icon展示属性
         * @property iconOptions
         * @type {object}
         */

        /**
         * icon中心点的类型，可选类型如下：
         *      1. graph：绘制圆点，默认值
         *      2. image：固定图片
         *      3. dyImage：动态图片
         * @property iconOptions.iconType
         * @type {string}
         */

        /**
         * icon中心点的绘制半径，当iconType为'graph'时才会生效
         * @property iconOptions.radius
         * @type {number}
         */

        /**
         * 动态图片的图片地址设置方法，当iconType为'dyImage'时才会生效
         * @property iconOptions.dyImageUrlFun
         * @type {function}
         */

        //iconOptions:{},


        /**
         * 纬度字段名
         * @property latField
         * @type {string}
         * @default 'STATIONLAT'
         */
        latField: 'STATIONLAT',

        /**
         * 经度字段名
         * @property lonField
         * @type {string}
         * @default 'STATIONLON'
         */
        lonField: 'STATIONLON',

        markerInstance: LW.valueMarker
    },

    valueLabelVisible: true,
    codeLabelVisible: false,

    /**
     * 设置Marker文本的状态
     * @param m {L.ValueMarker}
     * @protected
     */
    _setMarkerLabelStatus: function (m) {
        if (!this.nameLabelVisible)
            m.setNameLabelVisible(this.nameLabelVisible);
        if (!this.valueLabelVisible)
            m.setValueLabelVisible(this.valueLabelVisible);
        if (this.codeLabelVisible)
            m.setCodeLabelVisible(this.codeLabelVisible);
    },

    /**
     * 设置站号文本(code label)的显隐
     * @method setCodeLabelVisible
     * @param visible {boolean}
     */
    setCodeLabelVisible: function (visible) {
        this.codeLabelVisible = visible;
        var setMarkerCodeVisible = function (marker) {
            if (marker instanceof LW.ValueMarker)
                marker.setCodeLabelVisible(visible);
        };
        this.eachLayer(setMarkerCodeVisible, this);
    },

    /**
     * 设置值文本(value label)的显隐
     * @method setValueLabelVisible
     * @param visible {boolean}
     */
    setValueLabelVisible: function (visible) {
        this.valueLabelVisible = visible;
        var setMarkerValueVisible = function (marker) {
            if (marker instanceof LW.ValueMarker)
                marker.setValueLabelVisible(visible);
        };
        this.eachLayer(setMarkerValueVisible, this);
    },

    /**
     * 隐藏无效值的Marker
     * @method setInvalidMarkerHidden
     */
    setInvalidMarkerHidden: function () {
        var _setInvalidMarkerVisible = function (m) {
            if (m instanceof LW.ValueMarker) {
                if (m.getValueInvalidity())
                    m.options.icon.getIcon().style.visibility = 'hidden';
            }
        };
        this.eachLayer(_setInvalidMarkerVisible, this);
    },

    /**
     * 显示所有Marker 用于过滤后的恢复
     * @method showAllMarker
     */
    showAllMarker: function () {
        var _showAllMarker = function (m) {
            if (m instanceof LW.NameMarker)
                m._icon.style.visibility = 'visible';
        };
        this.eachLayer(_showAllMarker, this);
    },

    /**
     * 过滤Marker 注：若Marker的value为无有效值则直接过滤
     * @method filterMarker
     * @param minValue {number} 不填或NaN时仅过滤出比maxValue小的值
     * @param isEqualMin {boolean} 是否将等于minValue的值过滤
     * @param maxValue {number} 不填或NaN时仅过滤出比minValue大的值
     * @param isEqualMax {boolean} 是否将等于maxValue的值过滤
     */
    filterMarker: function (minValue, isEqualMin, maxValue, isEqualMax) {
        var setMarkerVisible = function (m) {
            var value = m.value;
            if (Sun.Util.Common.isValid(value)) {
                var icon = m.options.icon.getIcon();
                if (m.getValueInvalidity())
                    return icon.style.visibility = 'hidden';
                if (isNaN(minValue) && isNaN(maxValue))
                    icon.style.visibility = 'visible';
                else if (isNaN(minValue)) {
                    icon.style.visibility = value <= maxValue ? 'visible' : 'hidden';
                    if (isEqualMax && value == maxValue)
                        icon.style.visibility = 'hidden';
                }
                else if (isNaN(maxValue)) {
                    icon.style.visibility = value >= minValue ? 'visible' : 'hidden';
                    if (isEqualMin && value == minValue)
                        icon.style.visibility = 'hidden';
                }
                else {
                    icon.style.visibility = value <= maxValue && value >= minValue ? 'visible' : 'hidden';
                    if (isEqualMin && value == minValue)
                        icon.style.visibility = 'hidden';
                    if (isEqualMax && value == maxValue)
                        icon.style.visibility = 'hidden';
                }
            }
        };
        this.eachLayer(setMarkerVisible, this);
    }

});

/**
 * @class LW.BaseZdzLayer
 * @constructor
 * @param options {object} 外部属性，可重设Properties
 * @param layers {object} 初始图层，可以不传
 * @returns {LW.BaseZdzLayer}
 */
LW.baseZdzLayer = function (options, layers) {
    return new LW.BaseZdzLayer(options, layers);
};


/**
 * 基础自动站--降水图层实例
 * @param options
 * @param layers
 * @returns {*}
 */
LW.baseZdzRainLayer = function (options, layers) {
    if (!options) options = {};
    options.valueField = options.valueField || 'RAIN_SUM_VALUE';
    options.legendData = options.legendData || Sun.LegendData.rain;
    return LW.baseZdzLayer(options, layers);
};

/**
 * 基础自动站--风图层实例
 * @param options
 * @param layers
 * @returns {*}
 */
LW.baseZdzWindLayer = function (options, layers) {
    if (!options) options = {};
    options.markerInstance = LW.baseZdzWindMarker;
    options.valueField = options.valueField || 'WIND_CURRENT_SPEEDVALUE';
    options.dirField = options.dirField || 'WIND_CURRENT_DIRVALUE';
    options.legendData = options.legendData || Sun.LegendData.wind;
    return LW.baseZdzLayer(options, layers);
};

/**
 * 基础自动站--气温图层实例
 * @param options
 * @param layers
 * @returns {*}
 */
LW.baseZdzAirtempLayer = function (options, layers) {
    if (!options) options = {};
    options.valueField = options.valueField || 'AIRTEMP_CURRENT_VALUE';
    options.legendData = options.legendData || Sun.LegendData.airtemp;
    return LW.baseZdzLayer(options, layers);
};

/**
 * 基础自动站--气压图层实例
 * @param options
 * @param layers
 * @returns {*}
 */
LW.baseZdzPressureLayer = function (options, layers) {
    if (!options) options = {};
    options.valueField = options.valueField || 'STAPRESSURE_CURRENT_VALUE';
    options.legendData = options.legendData || Sun.LegendData.pressure;
    return LW.baseZdzLayer(options, layers);
};

/**
 * 基础自动站--湿度图层实例
 * @param options
 * @param layers
 */
LW.baseZdzRhLayer = function (options, layers) {
    if (!options) options = {};
    options.valueField = options.valueField || 'RH_CURRENT_VALUE';
    options.legendData = options.legendData || Sun.LegendData.rh;
    return LW.baseZdzLayer(options, layers);
};


/**
 * 基础自动站--能见度图层
 * @class LW.BaseZdzVisibLayer
 * @extends L.BaseZdzLayer
 */

LW.BaseZdzVisibLayer = LW.BaseZdzLayer.extend({
    options: {
        //initShowCode:'58847',

        markerInstance: LW.valueMarker
    },

    // 能见度范围圈
    visibleRangeCircle: null,

    initialize: function (options, layers) {
        LW.BaseZdzLayer.prototype.initialize.call(this, options, layers);
        if (!this.visibleRangeCircle)
            this.visibleRangeCircle = L.circle([0, 0], 0, {
                color: '#fe7a04',
                fillColor: '#fee904',
                fillOpacity: 0.2,
                weight: 1
            });
    },

    onAdd: function (map) {
        LW.BaseLayer.prototype.onAdd.call(this, map);
        if (this.visibleRangeCircle)
            map.addLayer(this.visibleRangeCircle);
    },

    onRemove: function (map) {
        LW.BaseLayer.prototype.onRemove.call(this, map);
        if (this.visibleRangeCircle)
            map.removeLayer(this.visibleRangeCircle);
    },

    setData: function (data) {
        LW.BaseZdzLayer.prototype.setData.call(this,data);
        this.on('click', this._showRange);
    },

    // _setData: function (source) {
    //     var data = source.FieldName?source.Rows:source;
    //     for (var i = 0; i < data.length; i++) {
    //         var o = data[i];
    //         var options = Sun.Util.Data.clone(this.options);
    //         var lat = Sun.Util.Data.getValueByField(o,options.latField,source.FieldName);
    //         var lng = Sun.Util.Data.getValueByField(o,options.lonField,source.FieldName);
    //         if (lat != '' && lng != '') {
    //             if (o.minZoom) options.minZoom = o.minZoom;
    //             var m = options.markerInstance([lat, lng], options);
    //             m.id = o[options.markerIdField];
    //             m.addTo(this).setData(o,source.FieldName);
    //         }
    //     }
    //     this.on('click', this._showRange);
    // },

    /**
     * 设置能见度范围圈的大小及位置
     * @param e
     * @private
     */
    _showRange: function (e) {
        var m = e.layer;
        var value = Sun.Util.Data.getValueByField(m.data,m.options.valueField,this.data.FieldName);
        this.visibleRangeCircle.setLatLng(m.getLatLng());
        this.visibleRangeCircle.setRadius(value);
    }
});


LW.baseZdzVisibLayer = function (options, layers) {
    if (!options) options = {};
    options.valueField = options.valueField || 'VISIBILITY_CURRENT_VALUE';
    options.legendData = options.legendData || Sun.LegendData.visible;
    options.scale = options.scale || 0.001;
    return new LW.BaseZdzVisibLayer(options, layers);
};

/**
 * 综合填图图层
 * @class LW.SynZdzLayer
 * @extends LW.BaseZdzLayer
 */
LW.SynZdzLayer = LW.BaseZdzLayer.extend({
    options: {

        /**
         * 左侧值字段名
         * @property valueLeftField
         * @default ''
         */
        valueLeftField: '',

        /**
         * 右侧值字段名
         * @property valueRightField
         * @default ''
         */
        valueRightField: '',

        /**
         * 风速值字段名
         * @property windSpeedField
         * @default ''
         */
        windSpeedField: '',

        markerInstance: LW.synZdzMarker
    },

    resetLabelField: function (valueField, valueLeftField, valueRightField, windSpeedField, dirField) {
        this.options.valueField = valueField;
        this.options.valueLeftField = valueLeftField;
        this.options.valueRightField = valueRightField;
        this.options.windSpeedField = windSpeedField;
        this.options.dirField = dirField;
    },

    setValueLabelLeftVisible: function (visible) {
        var setMarkerValueVisible = function (marker) {
            if (marker instanceof L.SynZdzMarker)
                marker.setValueLabelLeftVisible(visible);
        };
        this.everyMarker(setMarkerValueVisible);
    },
    setValueLabelRightVisible: function (visible) {
        var setMarkerValueVisible = function (marker) {
            if (marker instanceof L.SynZdzMarker)
                marker.setValueLabelRightVisible(visible);
        };
        this.everyMarker(setMarkerValueVisible);
    }
});

LW.synZdzLayer = function (options, layers) {
    return new LW.SynZdzLayer(options, layers);
};

/**
 * 水位图层
 * @class LW.WaterLevelLayer
 * @extends LW.BaseZdzLayer
 */
LW.WaterLevelLayer = LW.BaseZdzLayer.extend({
    options: {
        iconSize: new L.Point(80, 60),
        iconType: 'image'
    },

    setData: function (currentData, historyData) {
        this.clearLayers();
        for (var i = 0; i < currentData.length; i++) {
            var currentItem = currentData[i];
            var historyItem = Sun.Util.Array.getItemByField(historyData, "STATIONCODE", currentItem.STATIONCODE);
            var options = Sun.Util.Data.clone(this.options);
            var m = LW.waterLevelMaker([currentItem.STATIONLAT, currentItem.STATIONLON], options);
            m.addTo(this).setData(currentItem, historyItem);
        }
    }
});

LW.waterLevelLayer = function (options, layers) {
    options.valueField = options.valueField || 'WATERLEVEL_CURRENT_VALUE';
    return new LW.WaterLevelLayer(options, layers);
};

/**
 * 预警信号icon
 */
LW.AlmtIcon = L.Icon.extend({
    options: {
        color: '#000',
        iconSize: new L.Point(310, 85), //宽高(可调节间隔)
        timeFormat: 'MM-dd hh:mm',
        timeVisible: true,//是否显示时间
        stationVisible: true,//是否显示站点名
        imgWidth:70
    },

    getIcon: function () {
        return this.container;
    },

    createIcon: function () {
        this.container = document.createElement('div');
        this.shell = L.DomUtil.create('div', 'lw-almt-shell', this.container);
        this.almtContainer = L.DomUtil.create('div', 'lw-almt', this.shell);
        this._setIconStyles(this.container, "icon");
    },

    setData: function (data) {
        for (var i = 0; i < data.length; i++) {
            var item = data[i];
            var almt = L.DomUtil.create('div', '', this.almtContainer);
            // img
            var img = L.DomUtil.create('img', '', almt);
            img.src = this.options.iconBaseUrl + data[i]['SIGNAL'] + '.png';
            img.data = item;
            img.offsetX = this._getOffsetX(i,data.length);
            img.id = item['ID'];
            img.onclick = this.options.markerClick;

            // label
            if (this.options.timeVisible) {
                var timeText = new Date(item['ISSUETIME2'].replace(/-/g, '/')).format(this.options.timeFormat);
                var timeLabel = L.DomUtil.create('span', '', almt);
                timeLabel.innerText = timeText || '';
            }
        }
        // 站名
        if (this.options.stationVisible) {
            var station = data[0]['STATIONNAME'];
            var stationLabel = L.DomUtil.create('span', '', this.shell);
            stationLabel.innerText = station || '';
            this.shell.appendChild(stationLabel);
        }
    },
    
    _getOffsetX:function (index,length) {
        var imgWidth = this.options.imgWidth;
        index = index+1;
        var c = length/2+0.5;
        return (index-c)*imgWidth;
    }
});

LW.AlmtMarker = LW.NameMarker.extend({
    setData: function (data) {
        this.data = data;
        this.options.icon.setData(data);
    },



    _initInteraction: function () {

        if (!this.options.interactive) { return; }

        L.DomUtil.addClass(this._icon, 'leaflet-interactive');

        // this.addInteractiveTarget(this._icon);

        if (L.Handler.MarkerDrag) {
            var draggable = this.options.draggable;
            if (this.dragging) {
                draggable = this.dragging.enabled();
                this.dragging.disable();
            }

            this.dragging = new L.Handler.MarkerDrag(this);

            if (draggable) {
                this.dragging.enable();
            }
        }
    }
});

LW.almtMarker = function (latlng, options) {
    if (!options) options = {};
    options.icon = options.icon || new LW.AlmtIcon(options.iconOptions);
    return new LW.AlmtMarker(latlng, options);
};

/**
 * @module Layer.Base
 */

/**
 * 预警信号图层
 *
 * Features :
 *      1. 支持多预警信号，及每个预警信号发出点击事件
 *      2. 通过配置iconOptions中的iconBaseUrl来设置预警信号的图片跟地址
 *      3. 可以为指定的站点图标设置描边
 *
 * Update Note：
 *      + v1.0.0 ：Created
 *      + v1.0.4-dev ：修改布局方式，采用css文件布局，需引用lealet.weather.css
 *      + v1.1.0-dev ：点击可以传出offsetX，用于显示弹框的偏移量
 *
 * @class LW.AlmtLayer
 * @extends L.BaseLayer
 * @demo demo/base/almt.html {}
 */

LW.AlmtLayer = LW.BaseLayer.extend({
    options: {
        latField: 'STATIONLAT',
        lonField: 'STATIONLON',
        markerInstance: LW.almtMarker,
        iconBaseUrl: '',
        iconOptions: {
            iconBaseUrl: "images/almt/"  //图片路径 建议使用100x85的预警信号图
        }
    },

    _hasWarning: false,

    _setData: function (data) {
        var almtList = this._getAlmtList(data);
        var proto = this;
        for (var key in almtList) {
            var item = almtList[key];
            var item0 = item[0];
            if (item0['SIGNAL'] != '无预警信号') {
                this._hasWarning = true;
                var options = Sun.Util.Data.clone(this.options);
                options.iconOptions.markerClick = function (e) {
                    e.stopPropagation();
                    proto.fire("AlmtMarkerClick", {data: e.currentTarget.data,offsetX: e.currentTarget.offsetX});
                };
                var m = options.markerInstance([item0[options.latField], item0[options.lonField]], options);
                m.id = item0.STATIONID;
                m.addTo(this).setData(item);
                this._setMarkerLabelStatus(m);
            }
        }
    },

    _getAlmtList: function (data) {
        var list = {};
        for (var i = 0; i < data.length; i++) {
            var stationId = data[i]["STATIONID"];
            list[stationId] = list[stationId] || [];
            list[stationId].push(data[i]);
        }
        return list;
    },

    /**
     * 为图标设置描边
     * @param stationId {string} data.STATIONID
     * @param id {string} data.ID 不传时可将stationId相等的所有icon描边
     */
    setIconStrokeByID: function (stationId, id) {
        this.eachLayer(function (m) {
            var imgs = m.options.icon.getIcon().getElementsByTagName('img');
            for (var i = 0; i < imgs.length; i++) {
                var dot = imgs[i];
                var idFlag = (typeof (id) != "undefined" && dot.id == id) || (typeof id == "undefined");
                if (idFlag && m.id == stationId) {
                    dot.style.border = '3px red solid';
                    dot.style.borderRadius = '5px';
                }
                else
                    dot.style.border = 'none';
            }
        }, this);
    },


    hasWarning: function () {
        return this._hasWarning;
    }
});

/**
 * @class LW.AlmtLayer
 * @constructor
 * @param [options] [object] 外部属性，可重设Properties
 * @param [layers] [object] 初始图层，可以不传
 * @returns {LW.AlmtLayer}
 */
LW.almtLayer = function (options, layers) {
    return new LW.AlmtLayer(options, layers);
};
/**
 * 预警信号icon
 */
LW.SuperAlmtIcon = LW.AlmtIcon.extend({
    options: {
        provStationId: 'none'
    },

    setData: function (data) {
        for (var i = 0; i < data.length; i++) {
            var item = data[i];
            var almt = L.DomUtil.create('div', '', this.almtContainer);
            // img
            var img = L.DomUtil.create('img', '');
            img.src = this.options.iconBaseUrl + data[i]['SIGNAL'] + '.png';
            img.data = item;
            this._whenImgLoaded(img, almt);
        }
        // 站名
        if (this.options.stationVisible) {
            var station = data[0]['STATIONNAME'];
            var stationLabel = L.DomUtil.create('span', '', this.shell);
            stationLabel.innerText = station || '';
            this.shell.appendChild(stationLabel);
        }
    },

    _whenImgLoaded: function (img, almt) {
        var me = this;
        if (img.complete)
            this._setIcon(img, almt);
        else {
            img.onload = function (e) {
                me._setIcon(img, almt);
            };
        }
    },
    _setIcon: function (img, almt) {
        var item = img.data;
        if (img.data['CHANGE'] == 3) {
            // 解除发布的站点变成灰色
            var grayDot = L.DomUtil.create('img');
            grayDot.src = this.gray(img);
            grayDot.data = img.data;
            img = grayDot;
        }
        almt.appendChild(img);
        img.id = item['ID'];
        img.onclick = this.options.markerClick;

        var cityLevel = this._getCityLevel(item);
        if (cityLevel == 0)// 县级站点
            img.className = 'smaller';

        // label
        if (this.options.timeVisible) {
            var timeText = new Date(item['ISSUETIME2'].replace(/-/g, '/')).format(this.options.timeFormat);
            var timeLabel = L.DomUtil.create('span', '', almt);
            timeLabel.innerText = timeText || '';
        }

        // 保存dot用于过滤
        this.levelDots = this.levelDots || [];
        var levelDot = Sun.Util.Array.getItemByField(this.levelDots, 'cityLevel', cityLevel);
        if (!levelDot) {
            levelDot = {cityLevel: cityLevel, dots: [almt]};
            this.levelDots.push(levelDot);
        }
        else
            levelDot.dots.push(almt);
    },

    // 0--县 1--市 2--省 3--全部
    _getCityLevel: function (item) {
        var stationType = item.STATIONTYPE;
        if (Sun.Util.Common.isValid(stationType)) {
            if (stationType == 1) //省
                return 2;
            else if (stationType == 0) //市
                return 1;
            else if (stationType == 3) //县
                return 0;
        }
        else {
            var stationName = item.STATIONNAME.slice(0, 2);
            var city = item.CITY.slice(0, 2);
            if (item.STATIONID == this.options.provStationId)
                return 2;
            if (stationName == city)
                return 1;
            else
                return 0;
        }
    },


    // 因为css设置灰度不能支持ie10和ie11，所以得用画布来转
    gray: function (imgObj) {
        // 最后要放到工具类中，实例不需拿出来
        var canvas = document.createElement('canvas');
        var canvasContext = canvas.getContext('2d');

        var imgW = imgObj.width;
        var imgH = imgObj.height;
        canvas.width = imgW;
        canvas.height = imgH;

        canvasContext.drawImage(imgObj, 0, 0);
        var imgPixels = canvasContext.getImageData(0, 0, imgW, imgH);

        for (var y = 0; y < imgPixels.height; y++) {
            for (var x = 0; x < imgPixels.width; x++) {
                var i = (y * 4) * imgPixels.width + x * 4;
                var avg = (imgPixels.data[i] + imgPixels.data[i + 1] + imgPixels.data[i + 2]) / 3;
                imgPixels.data[i] = avg;
                imgPixels.data[i + 1] = avg;
                imgPixels.data[i + 2] = avg;
            }
        }
        canvasContext.putImageData(imgPixels, 0, 0, 0, 0, imgPixels.width, imgPixels.height);
        return canvas.toDataURL();
    }
});


LW.superAlmtMarker = function (latlng, options) {
    if (!options) options = {};
    options.icon = options.icon || new LW.SuperAlmtIcon(options.iconOptions);
    return new LW.AlmtMarker(latlng, options);
};

/**
 * @module Layer.Base
 */

/**
 * Super预警信号图层
 *
 * Features :
 *      1. 支持多预警信号，及每个预警信号发出点击事件
 *      2. 通过配置iconOptions中的iconBaseUrl来设置预警信号的图片跟地址
 *      3. 支持解除发布预警信号变灰
 *      4. 支持市一级预警信号比县一级大，在leaflet.weather.css可重置大小
 *      5. 支持同一个站点有两种不同等级的预警信号
 *
 * Update Note：
 *      + v1.0.4-dev ：Created
 *
 * @class LW.SuperAlmtLayer
 * @extends L.AlmtLayer
 * @demo demo/base/superAlmt.html {}
 */

LW.SuperAlmtLayer = LW.AlmtLayer.extend({
    options: {
        markerInstance: LW.superAlmtMarker
    },

    /**
     * 通过城市等级显示预警信号
     * @param level {number} 等级：0--县 1--市 2--省 3--全部
     */
    showAlmtByCityLevel: function (level) {
        this.eachLayer(function (m) {
            var icon = m.options.icon;
            if (icon.levelDots.length == 1) {
                if (icon.levelDots[0].cityLevel == level || level == 3)
                    icon.getIcon().style.display = 'inline-block';
                else
                    icon.getIcon().style.display = 'none';
            }
            else {
                for (var i = 0; i < icon.levelDots.length; i++) {
                    var levelDot = icon.levelDots[i];
                    if (levelDot.cityLevel == level || level == 3) {
                        levelDot.dots.forEach(function (dot) {
                            dot.style.display = 'inline-block';
                        })
                    }
                    else {
                        levelDot.dots.forEach(function (dot) {
                            dot.style.display = 'none';
                        })
                    }
                }
            }

        }, this);
    }
});

/**
 * @class LW.SuperAlmtLayer
 * @constructor
 * @param [options] [object] 外部属性，可重设Properties
 * @param [layers] [object] 初始图层，可以不传
 * @returns {LW.SuperAlmtLayer}
 */
LW.superAlmtLayer = function (options, layers) {
    return new LW.SuperAlmtLayer(options, layers);
};
/**
 * 交通路况瓦片图层
 *
 * Update Note：
 *      + v1.4.3 ：Created
 *
 * @class LW.TrafficTileLayer
 * @extends L.TileLayer
 * @demo demo/base/trafficTileLayer.html  {路况}
 */
LW.TrafficTileLayer = L.TileLayer.extend({
    options:{
        autoRefresh: true,     //是否自动刷新，默认为true
        interval: 60,         //刷新间隔，默认180s
    },
    initialize: function (url, options) {
        var t = new Date().getTime();
        url = this.baseUrl = url || 'http://tm.amap.com/trafficengine/mapabc/traffictile?v=1.0&;t=1&x={x}&y={y}&z={z}&&t=';
        L.TileLayer.prototype.initialize.call(this,url+t,options);
        this.autoRefresh();
    },

    autoRefresh:function(){
        var  self = this;
        if(this.options.autoRefresh){
            setInterval(function () {
                self.refresh();
            },this.options.interval*1000);
        }
    },

    refresh:function () {
        var t = new Date().getTime();
        this.setUrl(this.baseUrl+t);
    }
});

LW.trafficTileLayer = function (url, options) {
    return new LW.TrafficTileLayer(url, options);
};

/**
 * 图片播放代理
 * options-showFun--图片展示方法，必填属性，
 */
LW.ImagePlayerAgent = L.Class.extend({
    options: {
        //showFun:null,
        playInterval: 1000
    },

    initialize: function (options) {
        L.setOptions(this, options);
    },

    sourceData: null,
    cursor: -1,
    timer: null,

    setData: function (data) {
        if (this.timer) this.stop();
        this.sourceData = data;
        this.cursor = 0;
    },

    getCurItem: function () {
        return this.sourceData[this.cursor];
    },

    _setCursor: function (c) {
        this.cursor = c;
        this.options.showFun(this.getCurItem(), c, this);
    },

    setItem: function (index) {
        this._setCursor(index);
    },

    showFirst: function () {
        if (this.timer) this.stop();
        this._setCursor(this.sourceData.length - 1);
    },

    showLast: function () {
        if (this.timer) this.stop();
        this._setCursor(0);
    },

    showPrev: function () {
        if (this.timer) this.stop();
        this._setCursor((this.cursor + 1) % this.sourceData.length);
    },

    showNext: function () {
        if (this.timer) this.stop();
        this._showNext();
    },

    _showNext: function () {
        this.cursor--;
        this._setCursor(this.cursor < 0 ? this.sourceData.length - 1 : this.cursor);
    },

    play: function () {
        if (this.timer) this.stop();
        var self = this;
        self._showNext();
        this.timer = setInterval(function () {
            self._showNext()
        }, this.options.playInterval);
    },

    stop: function () {
        window.clearInterval(this.timer);
        this.timer = null;
    }
});



/**
 * Created by whl on 2015/9/7.
 */
LW.PixelFilter = L.Class.extend({
    options: {
        //colorSpectrum:<Array>
    },

    filterColor: null,
    filterIndex: -1,

    initialize: function (options) {
        L.setOptions(this, options);
    },

    setFilterColor: function (value) {
        this.filterColor = value;
        this.filterIndex = this.options.colorSpectrum.indexOf(value);
    },

    setFilterParam: function(value){
        typeof value == "object" ? this.filterRange = value : this.filterIndex = value;
    },

    filter: function (imageData) {
        var self = this;
        for (var i = 0; i < imageData.data.length; i += 4) {
            var color = Sun.Util.Color.rgbToHex(imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]);
            var colorIndex = this.options.colorSpectrum.indexOf(color);
            if (color != '#000000') {
                if (isFilter(colorIndex))
                    imageData.data[i + 3] = 0;
                else
                    imageData.data[i + 3] = 255;
            }

        }
        return imageData;

        function isFilter(cIdx) {
            if(cIdx != -1){
                if(self.filterRange)
                    return cIdx < self.filterRange.min || cIdx > self.filterRange.max;
                else
                    return cIdx < self.filterIndex;
            }
        }
    }
});

/**
 * @module Layer.Base
 */

/**
 * 图片图层
 * Image Layer primary for sat.
 * @class LW.ImageLayer
 * @extends L.ImageOverlay
 */
LW.ImageLayer = L.ImageOverlay.extend({
    initialize: function (url, bounds, options) { // (String, LatLngBounds, Object)
        this._url = url;
        if (bounds)
            this._bounds = L.latLngBounds(bounds);

        L.setOptions(this, options);
        this._zoomAnimated = true;
        if (!this._image){
            this._initImage();
            if (this.options.opacity < 1) {
                this._updateOpacity();
            }
        }
    },

    /**
     * 设置图片地址
     * @method setUrl
     * @param url {string} 图片地址
     * @returns {LW.ImageLayer}
     */
    setUrl: function (url) {
        if (this.options.opacity < 1) {
            this._updateOpacity();
        }

        this._url = url;

        if (this._image) {
            this._image.src = url;
        }
        return this;
    },

    /**
     * 设置图片边界
     * @method setBounds
     * @param bounds {L.LatLngBounds|Array}
     * @returns {LW.ImageLayer}
     */
    setBounds: function (bounds) {
        this._bounds = (bounds instanceof L.LatLngBounds) ? bounds : L.latLngBounds(bounds);

        if (this._map) {
            this._reset();
        }
        return this;
    },

    _reset: function () {
        if (this._bounds) {
            var bounds = new L.Bounds(
                this._map.latLngToLayerPoint(this._bounds.getNorthWest()),
                this._map.latLngToLayerPoint(this._bounds.getSouthEast())),
                size = bounds.getSize();

            L.DomUtil.setPosition(this.getElement(), bounds.min);

            this.getElement().style.width = size.x + 'px';
            this.getElement().style.height = size.y + 'px';
        }
    },

    onAdd: function () {
        this.getPane().appendChild(this.getElement());
        this._reset();
    }
});

/**
 * @class LW.ImageLayer
 * @constructor
 * @param url 图片地址
 * @param bounds 图片边界
 * @param options 外部属性，可重设Properties
 * @returns {LW.ImageLayer}
 */
LW.imageLayer = function (url, bounds, options) {
    return new LW.ImageLayer(url, bounds, options);
};


/**
 * 雷达图层
 *
 * Features :
 *      1. 支持过滤，但需雷达图的色谱与设置的色谱一致
 *      2. 可像素化雷达图或者模化显示
 *      3. 因有对图片的像素化操作，所以服务端需配置允许跨域
 *
 * Update Note：
 *      + v1.0.0 ：Created
 *      + v1.0.3 ：色谱设置改为直接设置LegendData
 *      + v1.5.0 ：过滤方法支持双向过滤，索引过滤
 *
 * @class LW.RadarLayer
 * @extends LW.ImageLayer
 * @demo demo/base/radar.html  {雷达图层}
 */

LW.RadarLayer = LW.ImageLayer.extend({
    options: {
        /**
         * 透明度
         * @property opacity
         * @type {number}
         * @default 0.7
         */
        opacity: 0.7,

        crossOrigin: true,

        /**
         * 是否像素化展示
         * @property pixelate
         * @type {boolean}
         * @default false
         */
        pixelate: false,

        zIndex: null

        /**
         * 雷达图色谱(图例)
         * @property legendData
         * @type {Array}
         */
        //legendData:<Array>
    },

    canvas: null,
    ctx: null,
    imageData: null,
    filterParam: null,
    imageFilter: null,

    getElement: function () {
        return this.canvas;
    },

    initialize: function (url, bounds, options) { // (String, LatLngBounds, Object)
        this._url = url;
        if (bounds)
            this._bounds = L.latLngBounds(bounds);

        L.setOptions(this, options);
        if (!this.canvas)
            this._initCanvas();
    },

    setUrl: function (url) {
        this.imageData=null;
        if (!this._image) {
            this.on('load', this._imageLoaded);
            this._initImage();
            var self = this;
            this._image.onerror= function () {
                self.clear();
            };

            if (this.options.opacity < 1) {
                this.canvas.style.opacity = this.options.opacity;
            }
        }

        this._url = url;

        if (this._image) {
            this._image.src = url;
        }
        return this;
    },

    _initCanvas: function () {
        this.canvas = L.DomUtil.create('canvas', 'leaflet-radar-layer leaflet-zoom-animated');
        if(this.options.zIndex)
            this.canvas.style.zIndex = this.options.zIndex;
        if (this.options.pixelate)
            this.canvas.style.imageRendering = 'pixelated';
        this.ctx = this.canvas.getContext("2d");
        var imgOptions = this.options.legendData ? {colorSpectrum: Sun.Util.LegendData.getColors(this.options.legendData)} : {};
        this.imageFilter = new LW.PixelFilter(imgOptions);
    },

    clear: function(){
        var ctx = this.ctx,canvas = this.canvas;
        ctx.clearRect(0, 0,canvas.width,canvas.height);
    },

    /**
     * 设置雷达色谱
     * @method setColorSpectrum
     * @param legendData {Array} 色谱数据
     */
    setLegendData: function (legendData) {
        if(this.legendData == legendData) return;
        this.legendData = legendData;
        this.filterParam = null;
        this.imageFilter.options.colorSpectrum = legendData? Sun.Util.LegendData.getColors(legendData):null;
    },

    onRemove: function () {
        L.DomUtil.remove(this.canvas);
        if (this.options.interactive) {
            this.removeInteractiveTarget(this._image);
        }
    },

    _imageLoaded: function () {
        if (this.canvas) {
            this.canvas.width = this._image.width;
            this.canvas.height = this._image.height;
            this.ctx.drawImage(this._image, 0, 0);
            try {
                this.imageData = this.ctx.getImageData(0, 0, this._image.width, this._image.height);
            }
            catch (e) {
                console.log('getImageData error!');
            }
            if (this.filterParam)
                this.filter(this.filterParam);
        }
    },

    _animateZoom: function (e) {
        if (!this._bounds)
            return;

        var scale = this._map.getZoomScale(e.zoom),
            offset = this._map._latLngToNewLayerPoint(this._bounds.getNorthWest(), e.zoom, e.center);

        L.DomUtil.setTransform(this.canvas, offset, scale);
    },

    /**
     * 雷达过滤
     * @method filter
     * @param param 1. 过滤的颜色值 eg:'#02c200'
     *              2. 过滤的索引范围; if:<min || >max被过滤 eg:{min:3,max:8}
     *              3. 过滤的最小索引(数值); if:<index被过滤 eg:3
     */
    filter: function (param) {
        this.filterParam = param;
        this.imageFilter[typeof param == 'string' ? 'setFilterColor' : 'setFilterParam'](param);
        if (this.imageData) {
            //Tip:ImageData的构造方法在某些浏览器及手机中没有兼容
            var imgData = this.imageFilter.filter(this.imageData);
            this.ctx.putImageData(imgData, 0, 0);
        }
    }
});

/**
 * @class LW.RadarLayer
 * @constructor
 * @param url 图片地址
 * @param bounds 图片边界
 * @param options 外部属性，可重设Properties
 * @returns {LW.RadarLayer}
 */
LW.radarLayer = function (url, bounds, options) {
    return new LW.RadarLayer(url, bounds, options);
};

/*	Curve extension for canvas 2.3.1
 *	Epistemex (c) 2013-2014
 *	www.epistemex.com
 *	License: MIT
 */
// CanvasRenderingContext2D.prototype.curve=CanvasRenderingContext2D.prototype.curve||function(h,t,f,c){t=(typeof t==="number")?t:0.5;f=f?f:25;var j,d=1,e=h.length,n=0,m=(e-2)*f+2+(c?2*f:0),k=new Float32Array(m),a=new Float32Array((f+2)*4),b=4;j=h.slice(0);if(c){j.unshift(h[e-1]);j.unshift(h[e-2]);j.push(h[0],h[1])}else{j.unshift(h[1]);j.unshift(h[0]);j.push(h[e-2],h[e-1])}a[0]=1;for(;d<f;d++){var o=d/f,p=o*o,r=p*o,q=r*2,s=p*3;a[b++]=q-s+1;a[b++]=s-q;a[b++]=r-2*p+o;a[b++]=r-p}a[++b]=1;g(j,a,e);if(c){j=[];j.push(h[e-4],h[e-3],h[e-2],h[e-1]);j.push(h[0],h[1],h[2],h[3]);g(j,a,4)}function g(G,z,B){for(var A=2,H;A<B;A+=2){var C=G[A],D=G[A+1],E=G[A+2],F=G[A+3],I=(E-G[A-2])*t,J=(F-G[A-1])*t,K=(G[A+4]-C)*t,L=(G[A+5]-D)*t;for(H=0;H<f;H++){var u=H<<2,v=z[u],w=z[u+1],x=z[u+2],y=z[u+3];k[n++]=v*C+w*E+x*I+y*K;k[n++]=v*D+w*F+x*J+y*L}}}e=c?0:h.length-2;k[n++]=h[e];k[n]=h[e+1];for(d=0,e=k.length;d<e;d+=2){this.lineTo(k[d],k[d+1])}return k};

/*---------- B-SPLINE CALCULATION ----------*/
(function (window) {
    var Bspline = [ -1/6,  3/6, -3/6,  1/6,  // a,b,c,d cubic coefficients from P0
        3/6, -6/6,    0,  4/6,  // a,b,c,d cubic coefficients from P1
        -3/6,  3/6,  3/6,  1/6,  // a,b,c,d cubic coefficients from P2
        1/6,    0,    0,    0   // a,b,c,d cubic coefficients from P3
    ];
    function cubic(A, t) {
        var value = A[0] * t*t*t + A[1] * t*t + A[2] * t + A[3];
        return Sun.Util.Math.toRoundFixed(value,2);
    }
    function transform(m, v) {
        // IF v[3] IS UNDEFINED, SET IT TO 1 (THAT IS, ASSUME v IS A POINT).
        var x = v[0], y = v[1], z = v[2], w = v[3] === undefined ? 1 : v[3];

        // RETURN RESULT OF TRANSFORMING v BY MATRIX m.
        return [ x * m[0] + y * m[4] + z * m[ 8] + w * m[12],
            x * m[1] + y * m[5] + z * m[ 9] + w * m[13],
            x * m[2] + y * m[6] + z * m[10] + w * m[14],
            x * m[3] + y * m[7] + z * m[11] + w * m[15] ];
    }

    window.getBspline = function (pts) {
        var curve = [];
        var len = pts.length,
            tension = len > 1000 ? 1 / 2 : (len > 500 ? 1 / 4 : (len > 200 ? 1 / 6 : 1 / 10));
        for (var n = 0; n < len; n++) {
            var nm = (n - 1 + len) % len,
                n1 = (n + 1) % len,
                n2 = (n + 2) % len,
                X = transform(Bspline, [pts[nm].x, pts[n].x, pts[n1].x, pts[n2].x]),
                Y = transform(Bspline, [pts[nm].y, pts[n].y, pts[n1].y, pts[n2].y]);

            for (var t = 0; t < 1.0001; t += tension)
                curve.push({x: cubic(X, t), y: cubic(Y, t)});
        }
        return curve;
    }
})(window);

L.Canvas.mergeOptions({
    globalCompositeOperation: 'destination-in',
    /**
     * 双线配置,值为双线的间隔值或者不设置双线
     * @property doubleLine
     * @type {int|boolean}
     * @default false
     */
    doubleLine:false,
    /**
     * 遮罩的线宽。此属性在遮罩数据为折线时使用
     */
    maskLineWidth:0
});
L.Canvas.include({
    _initContainer: function () {
        var container = this._container = document.createElement('canvas');
        if(this.options.zIndex)
            this._container.style.zIndex = this.options.zIndex;
        if(!this.options.interactive)
            this._container.style.pointerEvents='none';

        L.DomEvent
            .on(container, 'mousemove', L.Util.throttle(this._onMouseMove, 32, this), this)
            .on(container, 'click dblclick mousedown mouseup contextmenu', this._onClick, this)
            .on(container, 'mouseout', this._handleMouseOut, this);

        this._ctx = container.getContext('2d');
    },
    // 增加双实线的写法
    _updatePoly: function (layer, closed) {
        if (!this._drawing) { return; }

        var i, j, len2, p,
            parts = layer._parts,
            len = parts.length,
            ctx = this._ctx;

        if (!len) { return; }

        this._drawnLayers[layer._leaflet_id] = layer;

        ctx.beginPath();

        if (ctx.setLineDash) {
            ctx.setLineDash(layer.options && layer.options._dashArray || []);
        }

        for (i = 0; i < len; i++) {
            for (j = 0, len2 = parts[i].length; j < len2; j++) {
                p = parts[i][j];
                ctx[j ? 'lineTo' : 'moveTo'](p.x, p.y);
            }
            if (closed) {
                ctx.closePath();
            }
        }

        this._fillStroke(ctx, layer);

        this._setDoubleLine(ctx, layer);

        // TODO optimization: 1 fill/stroke for all features with equal style instead of 1 for each feature
    },
    // 更新基数样条曲线
    _updateCardinalSpline:function (layer, closed) {
        if (!this._drawing) { return; }

        var i, j, len2, p,
            parts = layer._parts,
            len = parts.length,
            ctx = this._ctx;
        var curveZoom = layer.options.curveZoom || 7;

        if (!len) { return; }

        this._drawnLayers[layer._leaflet_id] = layer;

        ctx.beginPath();

        if (ctx.setLineDash) {
            ctx.setLineDash(layer.options && layer.options._dashArray || []);
        }

        var zoom = this._map.getZoom();
        var min = this._bounds.min, max = this._bounds.max;
        for (i = 0; i < len; i++) {
            var curve = parts[i];
            if(zoom >= curveZoom){
                var visible = false;
                for (j = 0, len2 = parts[i].length; j < len2; j++) {
                    p = parts[i][j];
                    if (p.x >= min.x && p.y >= min.y && p.x <= max.x && p.y <= max.y) {
                        visible = true;
                        break;
                    }
                }
                if(visible)
                    curve = getBspline(parts[i]);
            }

            for (j = 0, len2 = curve.length; j < len2; j++) {
                p = curve[j];
                ctx[j ? 'lineTo' : 'moveTo'](p.x, p.y);
            }
            if (closed) {
                ctx.closePath();
            }
        }


        this._fillStroke(ctx, layer);
        this._setDoubleLine(ctx, layer);
    },

    _setDoubleLine:function(ctx, layer){
        if(layer.options.doubleLine){
            var prev = ctx.globalCompositeOperation;
            ctx.globalCompositeOperation= 'destination-out';
            ctx.lineWidth = layer.options.doubleLine;
            ctx.stroke();
            ctx.globalCompositeOperation=prev;
        }
    },

    _redraw: function () {
        this._redrawRequest = null;

        this._clear(); // clear layers in redraw bounds
        this._draw(); // draw layers

        this._redrawBounds = null;

        this.setMask();
    },

    resetMask: function(maskGeoJson) {
        this.options.maskGeoJson = maskGeoJson;
        if(this._map) this._redraw();
    },

    setMask:function () {
        var maskGeoJson = this.options.maskGeoJson;
        if(maskGeoJson && this._map){
            if (maskGeoJson && maskGeoJson instanceof L.GeoJSON) {

                var offset = this.options.maskOffset ? this._bounds.min : L.point(0,0),
                    ctx=this._ctx;
                var prev = ctx.globalCompositeOperation;
                ctx.globalCompositeOperation= this.options.globalCompositeOperation;

                ctx.beginPath();
                var _layers = maskGeoJson._layers;
                for (var key in _layers) {
                    var parts = _layers[key]._parts;
                    for (var i = 0; i < parts.length; i++) {
                        if(parts[i].length >= 2){
                            for (var j = 0, len2 = parts[i].length; j < len2; j++) {
                                var p = parts[i][j];
                                ctx[j ? 'lineTo' : 'moveTo'](p.x - offset.x, p.y - offset.y);
                            }
                            if(!this.options.maskLineWidth)
                                ctx.closePath();
                        }
                    }
                }
                if(!this.options.maskLineWidth){
                    ctx.fillStyle = '#000';
                    ctx.fill("evenodd");
                }
                else{
                    ctx.lineWidth = this.options.maskLineWidth;
                    ctx.stroke();
                }
                ctx.globalCompositeOperation=prev;
            }
        }
    }
});


LW.CSpline = L.Polygon.extend({
    options:{
        noClip: true,
        smoothFactor: 0
    },
    _updatePath: function () {
        this._renderer._updateCardinalSpline(this, true);
    },
    _updateStyle: function () {
        this._renderer._updateStyle(this);
    }
});

LW.cSpline = function (latlngs, options) {
    return new LW.CSpline(latlngs, options);
};

/**
 * @module Renderer
 */
/**
 * LW的不变换canvas
 *
 * Features :
 *      1. no translate when update
 *      2. 继承于L.Canvas
 *      3. 默认可交互
 *      4. 可以设置遮罩属性的配置
 *
 * Update Note：
 *      + v1.0.0 ：Created
 *      + v1.4.7 ：由LW.NoTranslateCanvas改名为LW.Canvas
 *
 * @class LW.Canvas
 * @extends L.Canvas
 */

LW.Canvas = L.Canvas.extend({
    options: {
        padding: 0,
        interactive:true,
        /**
         * 遮罩矢量
         * @property maskGeoJson
         * @type {LW.maskGeoJson|null}
         * @default null
         */
        maskGeoJson:null,
        /**
         * 遮罩偏移
         * @property maskGeoJson
         * @type {LW.maskGeoJson|null}
         * @default true
         */
        maskOffset:true
    },

    resetInteractive:function (interactive) {
        this.options.interactive = interactive;
        if(interactive)
            this._container.style.pointerEvents='auto';
        else
            this._container.style.pointerEvents='none';
    },

    _update: function (reset) {
        if (this._map._animatingZoom && this._bounds) {
            return;
        }

        this._drawnLayers = {};

        L.Renderer.prototype._update.call(this);

        var b = this._bounds,
            container = this._container,
            size = b.getSize(),
            // m = L.Browser.retina ? 2 : 1;
            m = Sun.Common.dpr;
            // m = 1;// modified by helen in 2016/9/30

        L.DomUtil.setPosition(container, b.min);

        // set canvas size (also clearing it); use double size on retina
        if(container.width!==size.x || container.height!==size.y || reset){
            container.width = m * size.x;
            container.height = m * size.y;
            container.style.width = size.x + 'px';
            container.style.height = size.y + 'px';
        }

        //if (L.Browser.retina) {
           this._ctx.scale(m, m);
        //}

        // translate so we use the same path coordinates after canvas element moves
        // this._ctx.translate(-b.min.x, -b.min.y);

        // Tell paths to redraw themselves
        // this.fire('update');
    }
});
LW.canvas = function (options) {
    return L.Browser.canvas ? new LW.Canvas(options) : null;
};

// Tip:向下兼容v1.4.7的名字更换
LW.NoTranslateCanvas = LW.Canvas;
LW.noTranslateCanvas = LW.canvas;





var glUtil = {
    // 创建着色器方法，输入参数：渲染上下文，着色器类型，数据源
    createShader: function (gl, type, source) {
        var shader = gl.createShader(type); // 创建着色器对象
        gl.shaderSource(shader, source); // 提供数据源
        gl.compileShader(shader); // 编译 -> 生成着色器
        var success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
        if (success) {
            return shader;
        }

        console.log(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
    },

    createProgram: function (gl, vs, fs) {
        var program = gl.createProgram();
        var vertexShader = glUtil.createShader(gl, gl.VERTEX_SHADER, vs),
            fragmentShader = glUtil.createShader(gl, gl.FRAGMENT_SHADER, fs);
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        var success = gl.getProgramParameter(program, gl.LINK_STATUS);
        if (success) {
            return program;
        }

        console.log(gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
    },
    getPrgObj: function (gl, vs, fs) {
        var prgObj = {};
        var program = prgObj.program = glUtil.createProgram(gl, vs, fs);
        var attrs = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
        for (i = 0; i < attrs; i++) {
            var attr = gl.getActiveAttrib(program, i);
            prgObj[attr.name] = gl.getAttribLocation(program, attr.name)
        }
        var uniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        for (j = 0; j < uniforms; j++) {
            var uniform = gl.getActiveUniform(program, j);
            prgObj[uniform.name] = gl.getUniformLocation(program, uniform.name)
        }
        return prgObj;
    },
    bindTexture: function (gl, type, data, width, height) {
        var texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, type);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, type);
        data instanceof Uint16Array ? gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_SHORT_4_4_4_4, data) :
            data instanceof Uint8Array ? gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data) :
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
        gl.bindTexture(gl.TEXTURE_2D, null);
        return texture;
    },
    bindImgTexture:function(gl,type, source, width, height){
        var texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        // Tip:具有指定长宽的image/canvas的方法只有webgl2才支持，webgl1只支持2的幂次方长宽的图片纹理
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, type);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, type);
        gl.bindTexture(gl.TEXTURE_2D, null);
        return texture;
    },
    activeTexture: function (gl, tex, e) {
        gl.activeTexture(gl.TEXTURE0 + e);
        gl.bindTexture(gl.TEXTURE_2D, tex);
    }
};

/**
 * 基于webgl的Canvas
 *
 * Update Note：
 *      + v1.5.2 ：Created
 *
 * @class LW.GlCanvas
 * @extends L.Canvas
 */
LW.GlCanvas = L.Canvas.extend({

    _initContainer: function() {
        var canvas = this.canvas = this._container = document.createElement('canvas');
        this.gl = canvas.getContext("webgl2", {preserveDrawingBuffer: true,stencil: true}) ||
            canvas.getContext("experimental-webgl", {preserveDrawingBuffer: true,stencil: true});
        this.setStencilTest();
    },

    _update: function () {
        if (this._map._animatingZoom && this._bounds) { return; }

        this._drawnLayers = {};

        L.Renderer.prototype._update.call(this);

        var b = this._bounds,
            container = this._container,
            size = b.getSize(),
            m = L.Browser.retina ? 2 : 1;

        L.DomUtil.setPosition(container, b.min);

        // set canvas size (also clearing it); use double size on retina
        container.width = m * size.x;
        container.height = m * size.y;
        container.style.width = size.x + 'px';
        container.style.height = size.y + 'px';

        this._latLngBounds = L.latLngBounds(this._map.layerPointToLatLng(this._bounds.min), this._map.layerPointToLatLng(this._bounds.max));

        // Tell paths to redraw themselves
        this.fire('update');
    },

    _clear: function () {
        var gl = this.gl;
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
    },

    _draw:function () { },

    getVs: function() {
        return `attribute vec3 aPos;
                attribute vec2 aTextureCoords;
                varying vec2 vTextureCoord;
                void main() {
                    gl_Position = vec4(aPos,1.0);
                    vTextureCoord = aTextureCoords;
                }`;
    },

    getFs: function(){
        return ` precision highp float;
        varying vec2 vTextureCoord;
        uniform sampler2D uSampler;
        void main(void) {
            vec4 color = texture2D(uSampler, vec2(vTextureCoord.s, vTextureCoord.t));
            if (color.rgb == vec3(1.0,0.0,0.0))
                discard;
            gl_FragColor = color;
        }`
    },

    setStencilTest:function(){
        var gl = this.gl;
        if(gl){
            if(this.options.maskGeoJson){
                gl.enable(gl.STENCIL_TEST);

                if(!this.prgObj){
                    var maskVertex = [ -1,-1,0,  1,-1,0,  1,1,0,  -1,-1,0,  1,1,0,  -1,1,0];
                    var vsBuffer = this.vsBuffer = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, vsBuffer);
                    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(maskVertex), gl.STATIC_DRAW);

                    var maskTexCoordBuffer = this.maskTexCoordBuffer = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, maskTexCoordBuffer);
                    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);

                    this.prgObj = glUtil.getPrgObj(gl,this.getVs(),this.getFs());
                }
            }
            else
                gl.disable(gl.STENCIL_TEST);
        }
    },

    resetMask: function(maskGeoJson) {
        this.options.maskGeoJson = maskGeoJson;
        this.setStencilTest();
        if(this._map) this._redraw();
    },

    setMask:function () {
        var maskGeoJson = this.options.maskGeoJson;
        var gl = this.gl, prgObj = this.prgObj;
        if(maskGeoJson && this._map && gl && prgObj){
            if (maskGeoJson instanceof L.GeoJSON) {
                if (!this.mask) {
                    this.mask = L.DomUtil.create('canvas');
                    this.maskCtx = this.mask.getContext("2d");
                }
                var self = this;
                var mask = this.mask,container = this._container;
                drawMask2D();
                drawMaskWebgl();
            }
        }

        function drawMask2D() {
            L.DomUtil.setPosition(mask, L.DomUtil.getPosition(container));
            mask.width = container.width;
            mask.height = container.height;
            mask.style.width = container.style.width;
            mask.style.height = container.style.height;

            var ctx = self.maskCtx,offset = self._bounds.min;
            ctx.beginPath();
            ctx.fillStyle = '#f00';
            ctx.fillRect(0, 0, container.width, container.height);
            ctx.fillStyle = '#ff0';
            var _layers = maskGeoJson._layers;
            for (var key in _layers) {
                var parts = _layers[key]._parts;
                for (var i = 0; i < parts.length; i++) {
                    if (parts[i].length >= 2) {
                        for (var j = 0, len2 = parts[i].length; j < len2; j++) {
                            var p = parts[i][j];
                            ctx[j ? 'lineTo' : 'moveTo'](p.x - offset.x, p.y - offset.y);
                        }
                        ctx.closePath();
                    }
                }
            }
            ctx.fill("evenodd");
            // console.log(this.mask.toDataURL("image/png"));
        }

        function drawMaskWebgl() {
            gl.useProgram(prgObj.program);

            gl.bindBuffer(gl.ARRAY_BUFFER, self.vsBuffer);
            gl.vertexAttribPointer(prgObj.aPos, 3, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(prgObj.aPos);

            gl.bindBuffer(gl.ARRAY_BUFFER, self.maskTexCoordBuffer);
            gl.enableVertexAttribArray(prgObj.aTextureCoords);
            gl.vertexAttribPointer(prgObj.aTextureCoords, 2, gl.FLOAT, false, 0, 0);

            // Always pass test
            gl.stencilFunc(gl.ALWAYS, 1, 0xff);
            gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
            gl.stencilMask(0xff);
            gl.clear(gl.STENCIL_BUFFER_BIT);
            // No need to display the triangle
            gl.colorMask(0, 0, 0, 0);

            gl.deleteTexture(self.maskTexture);
            var maskTexture = self.maskTexture = glUtil.bindImgTexture(gl, gl.LINEAR, mask, mask.width, mask.height);
            glUtil.activeTexture(gl, maskTexture, 0);
            gl.uniform1i(prgObj.uSampler, 0);

            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
    }
});


LW.glCanvas = function (options) {
    return new LW.GlCanvas(options);
};




/**
 * Created by whl on 2016/1/6.
 */
LW.ShadowCanvas = L.Canvas.extend({
    options: {
        padding: 0,
        shadow:true,
        shadowColor:'#999',
        shadowOffsetX:20,
        shadowOffsetY:20,
        shadowBlur:10
    },
    _fillStroke: function (ctx, layer) {
        if(this.options.shadow){
            ctx.shadowColor = this.options.shadowColor;
            ctx.shadowOffsetX = this.options.shadowOffsetX;
            ctx.shadowOffsetY = this.options.shadowOffsetY;
            ctx.shadowBlur = this.options.shadowBlur;
        }

        var options = layer.options;

        if (options.fill) {
            ctx.globalAlpha = options.fillOpacity;
            ctx.fillStyle = options.fillColor || options.color;
            ctx.fill(options.fillRule || 'evenodd');
        }
        if (options.stroke && options.weight !== 0) {
            ctx.globalAlpha = options.opacity;
            ctx.lineWidth = options.weight;
            ctx.strokeStyle = options.color;
            ctx.lineCap = options.lineCap;
            ctx.lineJoin = options.lineJoin;
            ctx.stroke();
        }

        if(this.options.shadow){
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            ctx.shadowBlur = 0;
        }
    }
});
LW.shadowCanvas = function (options) {
    return L.Browser.canvas ? new LW.ShadowCanvas(options) : null;
};

/**
 * 可剪裁的SVG
 * Features :
 *      1. 可设置遮罩
 *      2. 可设置pattern填充
 *
 * Update Note：
 *      + v1.0.0 ：Created
 *      + v1.4.4 ：1. 增加patternLegend属性来设置不同的模式填充
 * @class LW.ClipPathSvg
 * @extends L.SVG
 */
LW.ClipPathSvg = L.SVG.extend({
    options:{
        maskGeoJson:null,
        /**
         * 模式填充图例
         *
         * 数据格式 ：[{id:xx,color:'#f00',type:'r_bias',lineWidth:'2',width:15}]
         *
         * type :
         *      1. r_bias: 右斜线（若数据不传type，默认为右斜线）
         *      2. l_bias: 左斜线
         *      3. h_line: 横线
         *      4. v_line: 竖线
         *
         * @property patternLegend
         * @type {Array|null}
         * @default null
         */
        patternLegend:null
    },

    initialize: function (options) {
        L.SVG.prototype.initialize.call(this,options);
        if (!this._container) {
            this._initContainer(); // defined by renderer implementations

            if (this._zoomAnimated) {
                L.DomUtil.addClass(this._container, 'leaflet-zoom-animated');
            }
        }
    },

    onAdd: function () {
        this.getPane().appendChild(this._container);
        this._update();
        this.on('update', this._updatePaths, this);
    },

    setMaskKey:function (key) {
        this._rootGroup = this._rootGroups[key];
    },

    _initContainer: function () {
        this._container = L.SVG.create('svg');
        L.DomUtil.addClass(this._container, 'leaflet-zoom-animated');
        this.id = L.stamp(this);

        // makes it possible to click through svg root; we'll reset it back in individual paths
        this._container.setAttribute('pointer-events', 'none');

        this._rootGroup = L.SVG.create('g');
        this._container.appendChild(this._rootGroup);

        var defs = this.defs = L.SVG.create('defs');
        this._container.appendChild(defs);

        this._initPatten();
        this._initClipPath();
    },

    patternFn: {
        'r_bias':function (pat,item,a) {
            var line1 = this.createLine(0,a,a,0,item.color,item.strokeWidth);
            pat.appendChild(line1);
            var line2 = this.createLine(-1,1,1,-1,item.color,item.strokeWidth);
            pat.appendChild(line2);
            var line3 = this.createLine(a-1,a+1,a+1,a-1,item.color,item.strokeWidth);
            pat.appendChild(line3);
        },
        'l_bias':function (pat,item,a) {
            var line1 = this.createLine(0,0,a,a,item.color,item.strokeWidth);
            pat.appendChild(line1);
            var line2 = this.createLine(-1,a-1,1,a+1,item.color,item.strokeWidth);
            pat.appendChild(line2);
            var line3 = this.createLine(a-1,-1,a+1,1,item.color,item.strokeWidth);
            pat.appendChild(line3);
        },
        'h_line': function(pat,item,a){
            var line1 = this.createLine(0,a/2,a,a/2,item.color,item.strokeWidth);
            pat.appendChild(line1);
        },
        'v_line': function(pat,item,a){
            var line1 = this.createLine(a/2,0,a/2,a,item.color,item.strokeWidth);
            pat.appendChild(line1);
        },

        createLine: function (x1, y1, x2, y2,color,strokeWidth) {
            var line = L.SVG.create('line');
            line.setAttribute('x1', x1);
            line.setAttribute('y1', y1);
            line.setAttribute('x2', x2);
            line.setAttribute('y2', y2);
            line.setAttribute('stroke', color);
            line.setAttribute('stroke-width', strokeWidth);
            return line;
        }
    },

    _initPatten:function () {
        var patternLegend = this.options.patternLegend,defs = this.defs;
        var patternFn = this.patternFn;
        if(patternLegend){
            patternLegend.forEach(function (item) {
                if(item.type){
                    var a = item.width || 15;
                    var pat = L.SVG.create('pattern');
                    pat.setAttribute('id', item.id);
                    pat.setAttribute('width', a);
                    pat.setAttribute('height', a);
                    pat.setAttribute('patternUnits', 'userSpaceOnUse');
                    defs.appendChild(pat);
                    patternFn[item.type](pat,item,a);
                }
            });
        }
    },

    _initClipPath: function () {
        if(this.options.maskGeoJson instanceof L.GeoJSON){
            this._clipPath = L.SVG.create('clipPath');
            this.defs.appendChild(this._clipPath);
            this._clipPath.setAttribute('id', 'contour-mask' + this.id);
            this._updateClipPath();

            this._rootGroup.setAttribute('clip-path', 'url(#contour-mask' + this.id + ')');
        }
        else{//多个遮罩
            this._rootGroups = {};
            this._clipPaths = {};
            for(var key in this.options.maskGeoJson){
                var mask = this.options.maskGeoJson[key];
                var clipPath = L.SVG.create('clipPath');
                this.defs.appendChild(clipPath);
                clipPath.setAttribute('id', 'contour-mask' + this.id +key);
                this._clipPaths[key]=clipPath;
                this._updateClipPath(clipPath,mask);

                var rootGroup = L.SVG.create('g');
                this._container.appendChild(rootGroup);
                rootGroup.setAttribute('clip-path', 'url(#contour-mask' + this.id + key + ')');
                this._rootGroups[key]=rootGroup;
            }
        }

    },
    _update: function () {
        L.SVG.prototype._update.call(this);
        if(this.options.maskGeoJson instanceof L.GeoJSON)
            this._updateClipPath();
        else{
            for(var key in this.options.maskGeoJson){
                this._updateClipPath(this._clipPaths[key],this.options.maskGeoJson[key]);
            }
        }
    },
    _updateClipPath: function (clipPath,maskGeoJson) {
        clipPath = clipPath || this._clipPath;
        maskGeoJson = maskGeoJson || this.options.maskGeoJson;
        if (maskGeoJson && maskGeoJson instanceof L.GeoJSON) {
            var _layers = maskGeoJson._layers;
            for (i in _layers) {
                var path = _layers[i]._path;
                path.setAttribute('clip-rule','evenodd');
                clipPath.appendChild(path);
            }
        }
    },

    resetMask: function (maskGeoJson) {
        if (maskGeoJson && maskGeoJson instanceof  L.GeoJSON) {
            this.options.maskGeoJson = maskGeoJson;
            !this._clipPath ?  this._initClipPath() : this.defs.appendChild(this._clipPath);
            Sun.Util.Common.removeAllChildren(this._clipPath);
            this._updateClipPath();
        }
        else if(this._clipPath){
            this.defs.removeChild(this._clipPath);
        }
    },

    _updateStyle: function (layer) {
        L.SVG.prototype._updateStyle.call(this, layer);
        var options = layer.options;
        if(options.pointerEvents)
            layer._path.style.pointerEvents = options.pointerEvents;
    },
});

LW.clipPathSvg = function (options) {
    return L.Browser.svg ? new LW.ClipPathSvg(options) : null;
};

LW.HotspotSVG = LW.ClipPathSvg.extend({
    _initPath: function (layer) {
        L.SVG.prototype._initPath.call(this,layer);
        var path_over = layer._overPath = L.SVG.create('path');
        path_over.setAttribute('stroke', '#000');
        path_over.setAttribute('stroke-opacity', 0);
        path_over.setAttribute('stroke-width', 5);
        path_over.setAttribute('fill', 'none');

        var path = layer._hotspotPath = L.SVG.create('path');
        path.setAttribute('stroke', '#000');
        path.setAttribute('stroke-opacity', 0);
        path.setAttribute('stroke-width', 14);
        path.setAttribute('fill', 'none');
        path.style.pointerEvents='stroke';
    },

    _addPath: function (layer) {
        L.SVG.prototype._addPath.call(this,layer);
        this._rootGroup.appendChild(layer._overPath);
        this._rootGroup.appendChild(layer._hotspotPath);
        layer.addInteractiveTarget(layer._hotspotPath);
    },

    _removePath: function (layer) {
        L.SVG.prototype._removePath.call(this,layer);
        L.DomUtil.remove(layer._overPath);
        L.DomUtil.remove(layer._hotspotPath);
        layer.removeInteractiveTarget(layer._hotspotPath);
    },
    _setPath: function (layer, path) {
        L.SVG.prototype._setPath.call(this,layer,path);
        var _path = path.split('M');
        layer._hotspotPath.setAttribute('d', 'M'+_path[1]);
        layer._overPath.setAttribute('d', 'M'+_path[1]);
    },
});

LW.hotspotSvg = function (options) {
    return new LW.HotspotSVG(options);
};


LW.SVG = L.SVG.extend({
    _initContainer: function () {
        L.SVG.prototype._initContainer.call(this);
        this._defs = L.SVG.create('defs');
        this._container.appendChild(this._rootGroup);
    },
    _addPath: function (layer) {
        // defs path
        this._defs.appendChild(layer._path);
        layer._path.setAttribute('id', L.stamp(layer._path));

        // show path
        var path = L.SVG.create('use');
        path.setAttribute('xlink:href', layer._path._leaflet_id);
        this._rootGroup.appendChild(path);

        // text
        var text = L.SVG.create('text');
        this._rootGroup.appendChild(text);
        var textPath = layer._textPath = L.SVG.create('textPath');
        textPath.setAttribute('xlink:href', layer._path._leaflet_id);

        layer.addInteractiveTarget(layer._path);
    },

    _setPath: function (layer, path, text, gap, rotate) {
        layer._path.setAttribute('d', path);

        var d = this._getPathDistance(layer.getLatLngs());
        while (d > 0) {
            var tspan = L.SVG.create('tspan');
            layer._textPath.appendChild(tspan);
            tspan.innerText = text;
            if (Sun.Util.isValid(rotate))
                tspan.setAttribute('rotate', rotate);
            for (var i = 0; i < gap; i++) {
                var _tspan = L.SVG.create('tspan');
                tspan.setAttribute('stroke', 'none');
                tspan.setAttribute('fill', 'none');
                layer._textPath.appendChild(_tspan);
                _tspan.innerText = '_';
            }
            d -= 12 * (gap + 1);
        }


    },

    _getPathDistance: function (latlngs) {
        var p0, d = 0;
        for (var i = 0; i < latlngs.length; i++) {
            var latlng = latlngs[i];
            if (latlng && 'lat' in latlng) {
                if (d == 0)
                    p0 = this._map.latLngToLayerPoint(latlng);
                else {
                    var p1 = this._map.latLngToLayerPoint(latlng);
                    d += p0.distanceTo(p1);
                }
            }
            else if (L.Util.isArray(latlng))
                this._getPathDistance(latlng);
        }
        return d;
    },

    _removePath: function (layer) {
        L.DomUtil.remove(layer._path);
        L.DomUtil.remove(layer._textPath);
        layer.removeInteractiveTarget(layer._path);
    }
});

L.GeoJSON.include({
    setData:function (geojson) {
        this.clearLayers();
        if (geojson) {
            this.data = geojson;
            this.addData(geojson);
        }
    },
    
    resetOptionsStyle:function (style) {
        this.options.style = L.extend({}, this.options.style, style);
        return this.eachLayer(function (layer) {
            this.resetStyle(layer);
        }, this);
    }
});



/**
 * 几何图元集,最早的数值预报展示，将弃用
 *
 * Features :
 *      1. 支持贝塞尔曲线和折线组成的图元集
 *      2. 渲染器为svg
 *
 * @class LW.GeometryUnion
 * @extends L.Polygon
 */

LW.GeometryUnion = L.Polygon.extend({
    options: {
        renderer: L.svg(),
        maskGeoJson: null,
        pointerEvents: 'none',


        /**
         * 曲线类型
         *
         * Options :
         *      1. basis:贝塞尔曲线
         *      2. cardinal:基数样条曲线
         *
         * @property lineType
         * @type {string}
         * @default 'basis'
         */
        lineType: 'basis'
    },

    line: null,

    initialize: function (latlngs, options) {
        L.setOptions(this, options);
        this._latlngs = latlngs;
        this.line = d3.svg.line();
    },
    _project: function () {
        this._rings = '';
        this._projectLatlngs(this._latlngs);

        // project bounds as well to use later for Canvas hit detection/etc.
        var w = this._clickTolerance(),
            p = new L.Point(w, -w);

        // if (this._bounds.isValid()) {
        //    this._pxBounds = new L.Bounds(
        //        this._map.latLngToLayerPoint(this._bounds.getSouthWest())._subtract(p),
        //        this._map.latLngToLayerPoint(this._bounds.getNorthEast())._add(p));
        // }
    },
    // recursively turns latlngs into a set of rings with projected coordinates
    _projectLatlngs: function (latlngs) {
        for (var i = 0; i < latlngs.length; i++) {
            var planeType = latlngs[i].subplanetype;
            var interpolateType;
            if (planeType == 0)
                interpolateType = 'linear';
            else if (planeType == 1)
                interpolateType = this.options.lineType;
            else
                interpolateType = this.options.lineType + '-closed';
            this.line.interpolate(interpolateType);
            var items = latlngs[i].pointitems;
            if (items.length > 0) {
                var ring = [];
                for (var j = 0; j < items.length; j++) {
                    var p = this._map.latLngToLayerPoint(items[j]);
                    ring[j] = [p.x, p.y];
                }
                var d = this.line(ring);
                // 去除第一个Move点后MoveTo的点
                if (i != 0 && planeType != 3 && d.charAt(0) == 'M') {
                    d = d.slice(1);
                    while (d.charCodeAt(0) < 65) {//Tip:数字和','的Unicode编码均小于65
                        d = d.slice(1);
                    }
                }
                this._rings += d;
            }
        }
    },

    _updatePath: function () {
        this._renderer._setPath(this, this._rings);
    },

    _updateStyle: function () {
        this._renderer._updateStyle(this);
    }
});

LW.geometryUnion = function (latlngs, options) {
    return new LW.GeometryUnion(latlngs, options);
};

/**
 * 带标识文本的折线，默认A-Z..
 */
LW.LabelPolyline = L.Polyline.extend({
    options:{
        color: '#33fffb',
        iconUrl: 'close-icon.png',
        pane:'markerPane',
        ASCII_Start:65
    },
    initialize: function (latlngs, options) {
        L.Polyline.prototype.initialize.call(this, latlngs, options);
        this.labelLayer = L.layerGroup({pane: this.options.pane});

        this.on('editable:drawing:commit',function (e) {
            // console.log(e);
            this.addColseIcon(e.latlng);
        });
        this.on('editable:shape:delete', function (e) {
            this._map.removeLayer(this.labelLayer);
        });
    },

    onAdd: function () {
        L.Polyline.prototype.onAdd.call(this);
        this._map.addLayer(this.labelLayer);

        var deleteShape = function (e) {
            if ((e.originalEvent.ctrlKey || e.originalEvent.metaKey) && this.editEnabled()) this.editor.deleteShapeAt(e.latlng);
        };
        this.on('click', L.DomEvent.stop).on('click', deleteShape, this);
    },

    onRemove: function () {
        L.Polyline.prototype.onRemove.call(this);
        this._map.removeLayer(this.labelLayer);
    },

    getEditorClass: function (map) {
        return LW.Editable.LabelPolylineEditor;
    },

    deleteShape: function (e) {
        if (this.editEnabled()) this.editor.deleteShapeAt(e.latlng);
    },

    redraw: function () {
        if (this._map) {
            this._renderer._updatePath(this);
            var loc = this._latlngs[this._latlngs.length - 1];
            var label = LW.labelMarker(loc, {
                iconOptions: {
                    fontSize: '14px',
                    color: this.options.color,
                    edge:false,
                    bold: false,
                    iconAnchor: new L.Point(-6,0)
                }
            }).addTo(this.labelLayer);
            label.setData(String.fromCharCode(this.options.ASCII_Start++));
        }
        return this;
    },

    addColseIcon:function (latlng) {
        var self = this;
        if (!this._closeMarker) {
            var iconUrl = LW.defaultIconPath() + this.options.iconUrl;
            this._closeMarker = new L.Marker(latlng, {zIndexOffset:99999,icon: new L.Icon({iconUrl: iconUrl, iconAnchor: L.point(30, 9)})})
                .addTo(this.labelLayer);
            this._closeMarker.on('click',function () {
                self.deleteShape({latlng:latlng});
            })
        } else {
            this._closeMarker.setLatLng(latlng);
        }
    }

});
/**
 * 测距折线
 */
LW.MeasureLine = LW.LabelPolyline.extend({

    initialize: function (latlngs, options) {
        LW.LabelPolyline.prototype.initialize.call(this, latlngs, options);
        this.totalDistance = 0;
    },

    redraw: function () {
        if (this._map) {
            this._renderer._updatePath(this);
            var loc,text,color;
            if(this._latlngs.length == 1){
                loc = this._latlngs[0];
                text = '起点';
                color = '#fff';
            }
            else if (this._latlngs.length >= 2) {
                loc = this._latlngs[this._latlngs.length - 1];
                var loc1 = this._latlngs[this._latlngs.length - 2];
                var d = Sun.Util.Math.toFixed(loc1.distanceTo(loc) / 1000, 2);
                this.totalDistance = Sun.Util.Math.toFixed(parseFloat(this.totalDistance) + parseFloat(d), 2);
                text = this.totalDistance +'km';
                color = this.options.color;
            }
            var label = this.lastLabel = LW.labelMarker(loc, {
                iconOptions: {
                    fontSize: '14px',
                    color: color,
                    edge:false,
                    bold: false,
                    className:'lw-measure-info',
                    iconAnchor: new L.Point(-12,0)
                }
            }).addTo(this.labelLayer);
            label.setData(text);
        }
        return this;
    },

    addColseIcon:function (latlng) {
        LW.LabelPolyline.prototype.addColseIcon.call(this,latlng);
        this.lastLabel.setData('总长:'+this.totalDistance +'km')
    }
});

LW.measureLine = function (latlngs, options) {
  return new LW.MeasureLine(latlngs,options);
};

/**
 * 几何图形
 * @module Geometry
 */

L.SVG.include({
    _updateSpline: function (layer) {
        this._setPath(layer, L.SVG.pointsToSpline(layer._parts, layer.line));
    }
});
L.extend(L.SVG, {
    pointsToSpline: function (rings, d3SvgLine) {
        var str = '';
        for (i = 0, len = rings.length; i < len; i++) {
            var points = rings[i].map(function (item) {
                return [item.x,item.y];
            });
            str += d3SvgLine(points);
        }
        return str || 'M0 0';
    }
});
/**
 * 曲线
 *
 * Features :
 *      1. 贝塞尔曲线
 *      2. 支持闭合和不闭合曲线
 *      3. 渲染器为svg
 *
 * @class LW.Spline
 * @extends L.Polygon
 */

LW.Spline = L.Polygon.extend({

    options: {
        renderer: L.svg(),
        pointerEvents: 'none',

        /**
         * 是否为闭合曲线
         * @property closed
         * @type {boolean}
         * @default true
         */
        closed: true,

        /**
         * 曲线类型
         *
         * Options :
         *      1. basis:贝塞尔曲线
         *      2. cardinal:基数样条曲线
         *      3. linear 折线
         *
         * @property lineType
         * @type {string}
         * @default 'basis'
         */
        lineType: 'basis'
    },

    line: null,

    initialize: function (latlngs, options) {
        L.setOptions(this, options);
        this.line = d3.svg.line();
        var interpolateType = this.options.lineType + (this.options.closed ? '-closed' : '');
        this.line.interpolate(interpolateType);
        this._setLatLngs(latlngs);
    },

    bezierInterpolate: function (points) {
        var r = [];
        for (var i=1; i<points.length; i++) {
            var d0 = points[i-1], d1 = points[i];
            r.push([d0[0] + (d1[0]  - d0[0] ) * 0.5, d0[1]  + (d1[1] - d0[1]) * 0.5]);
        }
        return r;
    },

    _project: function () {
        // var pxBounds = new L.Bounds();
        this._rings = '';
        this._projectLatlngs(this._latlngs, this._rings);

        //project bounds as well to use later for Canvas hit detection/etc.
        // var w = this._clickTolerance(),
        //     p = new L.Point(w, w);
        //
        // if (this._bounds.isValid() && pxBounds.isValid()) {
        //     pxBounds.min._subtract(p);
        //     pxBounds.max._add(p);
        //     this._pxBounds = pxBounds;
        // }
    },
    //recursively turns latlngs into a set of rings with projected coordinates
    _projectLatlngs: function (latlngs, result/*, projectedBounds*/) {

        var flat = latlngs[0] instanceof L.LatLng,
            len = latlngs.length,
            i, ring;

        if (flat) {
            ring = [];
            for (i = 0; i < len; i++) {
                var p = this._map.latLngToLayerPoint(latlngs[i]);
                // projectedBounds.extend(p);
                ring[i] = [p.x, p.y];
            }
            var d = this.line(ring);
            this._rings += d;
        } else {
            for (i = 0; i < len; i++) {
                this._projectLatlngs(latlngs[i], result/*, projectedBounds*/);
            }
        }
    },

    _updatePath: function () {
        // this._renderer._updateSpline(this);
        this._renderer._setPath(this, this._rings);
    },

    _updateStyle: function () {
        this._renderer._updateStyle(this);
    }
});

LW.spline = function (latlngs, options) {
    return new LW.Spline(latlngs, options);
};



/**
 * @module Geometry
 */


/**
 * 采样加密的贝塞尔式折线
 *
 * * Features :
 *      1. 贝塞尔式折线
 *      2. 支持闭合和不闭合曲线
 *      3. 渲染器为svg
 *      4. 需引用turf.js
 *
 * @class LW.IntensiveSpline
 * @extends L.Polygon
 */
LW.IntensiveSpline = L.Polygon.extend({

    options:{
        weight:2,
        close:true,
        fill:false
    },

    addLatLng: function (latlng, latlngs) {
        this.s_latlngs.push(latlng);
        this.setLatLngs(this.s_latlngs);
    },

    getSLatLngs: function(){
        return this.s_latlngs;
    },

    _setLatLngs:function (latlngs) {
    //     if(latlngs.intensived)
    //         latlngs = latlngs.data;
    //     else{
    //         var result = this.s_latlngs = latlngs.map(function (item) {
    //             return L.latLng(item);
    //         });
    //         if(latlngs && latlngs.length>1){
    //             var coords = L.GeoJSON.latLngsToCoords(result, 0, this.options.close);
    //             var geoJson = L.GeoJSON.getFeature(this, {
    //                 type: this.options.close?'Polygon':'LineString',
    //                 coordinates: coords
    //             });
    //
    //             var bezier = turf.bezier(geoJson,10000,0.7);
    //             latlngs = bezier.geometry.coordinates.map(function (item) {
    //                 return L.latLng([item[1],item[0]]);
    //             });
    //         }
    //     }
    //
        L.Polygon.prototype._setLatLngs.call(this, latlngs);
        if(latlngs.length>1){
            var _latlngs = L.Polyline._flat(latlngs)? latlngs : latlngs[0];
            this.s_latlngs = _latlngs.map(function (item) {
                return L.latLng(item);
            });
        }
    },

    _convertLatLngs: function (latlngs) {
        var result = [],
            flat = L.Polyline._flat(latlngs);

        for (var i = 0, len = latlngs.length; i < len; i++) {
            if (flat) {
                result[i] = L.latLng(latlngs[i]);
                this._bounds.extend(result[i]);
            } else {
                result[i] = this._convertLatLngs(latlngs[i]);
            }
        }

        if(flat && latlngs && latlngs.length>1){
            var coords = L.GeoJSON.latLngsToCoords(result, 0, this.options.close);
            var geoJson = L.GeoJSON.getFeature(this, {
                type: this.options.close?'Polygon':'LineString',
                coordinates: coords
            });

            var bezier = turf.bezier(geoJson,10000,0.7);
            result = bezier.geometry.coordinates.map(function (item) {
                return L.latLng([item[1],item[0]]);
            });
        }

        return result;
    },

    _updatePath: function () {
        this._renderer._updatePoly(this, this.options.close);
    }
});

LW.intensiveSpline = function (latlngs, options) {
    return new LW.IntensiveSpline(latlngs, options);
};

L.SVG.include({
    _initText: function (layer) {
        var text = layer._text = L.SVG.create('text');
        text.setAttribute('stroke',layer.options.textStroke);
        text.setAttribute('fill',layer.options.textColor);
        text.setAttribute('font-weight',layer.options.fontWeight);
        text.setAttribute('font-size',layer.options.fontSize);
        text.setAttribute('text-anchor',"middle");
        text.setAttribute('dominant-baseline',"middle");
    },

    _addText: function (layer) {
        this._rootGroup.appendChild(layer._text);
    },

    _removeText: function (layer) {
        L.DomUtil.remove(layer._text);
    },

    _updateText: function (layer, pos, text) {
        layer._text.setAttribute('x', pos.x);
        layer._text.setAttribute('y', pos.y);
        layer._text.textContent = text;
    },
});

/**
 * 采样加密的贝塞尔式等值线(带文本的线)
 *
 * * Features :
 *      1. 线的类型与LW.IntensiveSpline一致，多了value文本展示
 *      2. 文本位置可在初始点或折线的中心
 * Update Note：
 *      + v1.4.5 : 增加文本在初始点或折线的中心的配置
 *
 * @class LW.IntensiveIsoline
 * @extends LW.IntensiveSpline
 */
LW.IntensiveIsoline = LW.IntensiveSpline.extend({
    options:{
        textColor:'#333',
        fontSize:16,
        fontWeight:'bold',
        textStroke:'none',
        textPosition: 'first', // first/center
        textOffset: L.point(0,0)
    },

    value:0,

    initialize: function (latlngs, options,value) {
        L.setOptions(this, options);
        this._setLatLngs(latlngs);
        this.value = value || 0;
    },

    onAdd: function () {
        this._renderer._initText(this);
        LW.IntensiveSpline.prototype.onAdd.call(this);
        this._renderer._addText(this);
    },

    onRemove: function () {
        this._renderer._removeText(this);
        LW.IntensiveSpline.prototype.onRemove.call(this);
    },

    _update: function () {
        if (!this._map) { return; }
        LW.IntensiveSpline.prototype._update.call(this);
        this._updateText();
    },

    _updateText:function () {
        var latlng = this.options.textPosition=='first'?this.getLatLngs()[0][0]:this.getCenter();
        if(latlng instanceof L.LatLng){
            var textPos = this._map.latLngToLayerPoint(latlng);
            textPos = textPos.add(this.options.textOffset);
            this._renderer._updateText(this,textPos,this.value);
        }
    },

    setValue:function (value) {
        this.value = value;
        this._updateText();
    }
});

LW.intensiveIsoline = function (latlngs, options,value) {
    return new LW.IntensiveIsoline(latlngs, options,value);
};

LW.IntensiveLabelLine = LW.IntensiveIsoline.extend({
    options:{
        textColor:'#333',
        fontSize:16,
        fontWeight:'800',
        textStroke:'#fff',
        textPosition: 'center', // first/center
        textOffset: L.point(0,0),
        iconsOptions:[]
    },
    onAdd: function () {
        this._renderer._initText(this);
        LW.IntensiveSpline.prototype.onAdd.call(this);
        this._renderer._addText(this);
        if(this.markers){
            var map = this._map;
            this.markers.forEach(function (m) {
                if(!map.hasLayer(m))
                    m.addTo(map);
            })
        }
    },

    onRemove: function () {
        this._renderer._removeText(this);
        if(this.marker && this._map.hasLayer(this.marker))
            this._map.removeLayer(this.marker);
        if(this.markers){
            var map = this._map;
            this.markers.forEach(function (m) {
                if(map.hasLayer(m))
                    map.removeLayer(m);
            })
        }
        LW.IntensiveSpline.prototype.onRemove.call(this);
    },
    _update: function () {
        if (!this._map) { return; }
        LW.IntensiveSpline.prototype._update.call(this);
        this._updateText();
        this._updateIcon();
    },
    _updateIcon:function (resetIcons) {
        var latlng = this.getCenter();
        if(latlng instanceof L.LatLng){
            if(!this.markers){
                var markers = this.markers = [];
                this.options.iconOptions.forEach(function (iOpts) {
                    markers.push(L.marker(latlng,{interactive:false,icon: L.icon(iOpts)}));
                })
            }
            else if(resetIcons){
                var iconOptions = this.options.iconOptions;
                this.markers.forEach(function (m,i) {
                    m.setIcon(L.icon(iconOptions[i]))
                })
            }
            else{
                this.markers.forEach(function (m) {
                    m.setLatLng(latlng);
                })
            }
        }
    },

    setIcons:function (iconOptions) {
        this.options.iconOptions = iconOptions;
        this._updateIcon(true);
    }

});

LW.intensiveLabelLine = function (latlngs, options,value) {
    return new LW.IntensiveLabelLine(latlngs, options,value);
};

LW.TextPathSVG= LW.ClipPathSvg.extend({
    options:{
        interactive:false
    },

    _initContainer: function () {
        LW.ClipPathSvg.prototype._initContainer.call(this);

        if(this.options.interactive){
            var me = this;
            L.DomEvent.on(this._rootGroup,'click',function (e) {
                var textPath = e.path[1];
                if(textPath){
                    var id = textPath.getAttribute('parentleafletid');
                    me._layers[id].fire('click',e,true);
                }
            });
        }
    },

    _initPath: function (layer) {
        // element
        var path = layer._path = L.SVG.create('path');
        layer._use = L.SVG.create('use');
        layer._text = L.SVG.create('text');
        layer._textPath = L.SVG.create('textPath');

        // set id and links
        var pathId = 'pathId'+L.stamp(layer._path);
        layer._path.setAttribute('id',pathId);
        layer._use.setAttribute('xlink:href','#'+pathId);
        layer._textPath.setAttribute('xlink:href','#'+pathId);
        layer._textPath.setAttribute('parentleafletid',layer._leaflet_id);

        // @namespace Path
        // @option className: String = null
        // Custom class name set on an element. Only for SVG renderer.
        if (layer.options.className) {
            L.DomUtil.addClass(path, layer.options.className);
        }

        if (layer.options.interactive) {
            // L.DomUtil.addClass(path, 'leaflet-interactive');
            L.DomUtil.addClass(layer._text, 'leaflet-interactive');
        }

        this._updateStyle(layer);
        this._layers[L.stamp(layer)] = layer;
    },

    _addPath: function (layer) {
        // defs path
        this.defs.appendChild(layer._path);

        // show path
        this._rootGroup.appendChild(layer._use);

        // text
        this._rootGroup.appendChild(layer._text);
        layer._text.appendChild(layer._textPath);

        // Tip:节点添加(appendChild)后Html标签正常但是渲染不正常，重新赋值html后才能正常显示
        layer._use.outerHTML = layer._use.outerHTML;
        layer._text.outerHTML = layer._text.outerHTML;

        layer.addInteractiveTarget(layer._path);
    },

    _setPath: function (layer, path, text, gap, rotate) {
        layer._path.setAttribute('d', path);

        this._distance = 0;
        this._setPathDistance(layer.getLatLngs());
        L.DomUtil.empty(layer._textPath);
        while (this._distance>0){
            var tspan = L.SVG.create('tspan');
            layer._textPath.appendChild(tspan);
            tspan.innerHTML = text;
            if(Sun.Util.Common.isValid(rotate))
                tspan.setAttribute('rotate',rotate);
            for(var i=0;i<gap;i++){
                var _tspan = L.SVG.create('tspan');
                _tspan.setAttribute('stroke','none');
                _tspan.setAttribute('fill','none');
                layer._textPath.appendChild(_tspan);
                _tspan.innerHTML = '_';
            }
            this._distance -= 10*(gap+1);
        }
        // Tip: 因_rootGroup中的节点不是正常append的来，而是HTML赋值来的，所以当其中内容要更变时必须找到对应的节点来更新
        var textNode = this._getTextNode('#pathId'+layer._path._leaflet_id);
        if(textNode)
            textNode.outerHTML = layer._text.outerHTML;
    },

    _getTextNode :function (xlink) {
        var nodes = this._rootGroup.childNodes;
        for(var i=0;i<nodes.length;i++){
            var node = nodes[i];
            if(node.nodeName == 'text'){
                var textPath = node.firstChild;
                if(xlink == textPath.getAttribute("xlink:href"))
                    return node;
            }
        }
    },

    _setPathDistance:function (latlngs) {
        var p0;
        for(var i=0;i<latlngs.length;i++){
            var latlng = latlngs[i];
            if(latlng && 'lat' in latlng){
                if(p0){
                    var p1 = this._map.latLngToContainerPoint(latlng);
                    this._distance += p0.distanceTo(p1);
                }
                p0=this._map.latLngToContainerPoint(latlng);
            }
            else if(L.Util.isArray(latlng))
                this._setPathDistance(latlng);
        }
    },

    _removePath: function (layer) {
        L.DomUtil.remove(layer._path);

        // 刪除use 和 text
        var xlink = '#pathId'+layer._path._leaflet_id;
        var deleteNodes=[];
        this._rootGroup.childNodes.forEach(function (node) {
            if(node.nodeName == 'text'){
                var textPath = node.firstChild;
                if(xlink == textPath.getAttribute("xlink:href"))
                    deleteNodes.push(node);
            }
            else if(xlink == node.getAttribute("xlink:href"))
                deleteNodes.push(node);
        });
        deleteNodes.forEach(function (node) {
            L.DomUtil.remove(node);
        });

        layer.removeInteractiveTarget(layer._path);
        delete this._layers[L.stamp(layer)];
    },

    _updateStyle: function (layer) {
        var path = layer._path,
            text = layer._text,
            options = layer.options;

        if (!path) { return; }

        if (options.stroke) {
            path.setAttribute('stroke', options.color);
            path.setAttribute('stroke-opacity', options.opacity);
            path.setAttribute('stroke-width', options.weight);
            path.setAttribute('stroke-linecap', options.lineCap);
            path.setAttribute('stroke-linejoin', options.lineJoin);

            text.setAttribute('font-size', '15px');
            text.setAttribute('stroke', options.color);

            if (options.dashArray) {
                path.setAttribute('stroke-dasharray', options.dashArray);
            } else {
                path.removeAttribute('stroke-dasharray');
            }

            if (options.dashOffset) {
                path.setAttribute('stroke-dashoffset', options.dashOffset);
            } else {
                path.removeAttribute('stroke-dashoffset');
            }
        } else {
            path.setAttribute('stroke', 'none');
        }

        path.setAttribute('fill', 'none');
        if(options.fill)
            text.setAttribute('fill', options.fillColor || options.color);
    }
});

LW.textPathSVG = function (options) {
    return new LW.TextPathSVG(options);
};

/*
 * 锋面
 */

LW.TextPathLine = LW.Spline.extend({
    options: {
        renderer: LW.textPathSVG(),
        pointerEvents: 'none',

        /**
         * 锋面类型
         *
         * Options :
         *      1. line:─
         *      2. triangle:▲
         *      3. arch:◖
         *
         * @property frontalType
         * @type {string}
         * @default 'cold'
         */
        textType: 'line',

        textRotate:0,

        /**
         * 锋面图标之间的间隔
         *
         * @property gap
         * @type {int}
         * @default 0
         */
        gap: 0,
        closed: false
    },

    pathTexts:{triangle:'▲',arch:'◖',line:'─',vline:' l '},

    initialize: function (latlngs, options) {
        LW.Spline.prototype.initialize.call(this, latlngs, options);
        this._pathText = this.pathTexts[this.options.textType];
    },

    _updatePath: function () {
        this._renderer._setPath(this, this._rings, this._pathText, this.options.gap, this.options.textRotate);
    }

});

LW.textPathLine = function (latlngs,options) {
    return new LW.TextPathLine(latlngs,options);
};


L.SVG.include({
    _updateQuadCircle: function (layer) {
        console.log('QuadCircle暂未支持svg器');
    }
});
L.Canvas.include({
    _updateQuadCircle: function (layer) {
        if (!this._drawing || layer._empty()) { return; }

        var p = layer._point,
            ctx = this._ctx,
            r = layer._radius,
            s = 1;

        this._drawnLayers[layer._leaflet_id] = layer;

        if (s !== 1) {
            ctx.save();
            ctx.scale(1, s);
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y / s, r.SE, 0, Math.PI * 0.5, false);
        ctx.arc(p.x, p.y / s, r.SW, Math.PI * 0.5, Math.PI, false);
        ctx.arc(p.x, p.y / s, r.NW, Math.PI, Math.PI * 1.5, false);
        ctx.arc(p.x, p.y / s, r.NE, Math.PI * 1.5, Math.PI * 2, false);
        ctx.arc(p.x, p.y / s, r.SE, 0, 0, false);

        if (s !== 1) {
            ctx.restore();
        }

        this._fillStroke(ctx, layer);
    },
});

/**
 * 四象限风圈
 *
 * Features :
 *      1. 东南、西南、东北、西北四个现象不同半径的风圈
 *      2. 暂只支持L.canvas作为renderer
 *
 * Update Note：
 *      + v1.3.0-dev ：Created
 *
 * @class LW.QuadCircle
 * @extends L.Circle
 * @demo demo/geometry/quadWindCircle.html
 */
LW.QuadCircle = L.Circle.extend({
    options:{
        radius:{NE:0,NW:0,SE:0,SW:0},
        renderer:L.canvas()
    },
    initialize: function (latlng, options, legacyOptions) {
        if (typeof options === 'number') {
            // Backwards compatibility with 0.7.x factory (latlng, radius, options?)
            options = L.extend({}, legacyOptions, {radius: options});
        }
        L.setOptions(this, options);
        this._latlng = L.latLng(latlng);

        this.setRadius(this.options.radius);
    },

    setRadius: function (radius) {
        this._mRadius = radius;
        this._maxRadius = Math.max(radius.NE,radius.NW,radius.SE,radius.SW);
        return this.redraw();
    },

    getBounds: function () {
        var half = [this._maxRadius, this._maxRadius];

        return new L.LatLngBounds(
            this._map.layerPointToLatLng(this._point.subtract(half)),
            this._map.layerPointToLatLng(this._point.add(half)));
    },
    _updateBounds: function () {
        var r = this._maxRadius,
            r2 = this._maxRadius,
            w = this._clickTolerance(),
            p = [r + w, r2 + w];
        this._pxBounds = new L.Bounds(this._point.subtract(p), this._point.add(p));
    },

    _project: function () {
        var lng = this._latlng.lng,
            lat = this._latlng.lat,
            map = this._map,
            crs = map.options.crs;
        this._radius = {};

        for(var key in this._mRadius){
            if (crs.distance === L.CRS.Earth.distance) {
                var d = Math.PI / 180,
                    latR = (this._mRadius[key] / L.CRS.Earth.R) / d,
                    top = map.project([lat + latR, lng]),
                    bottom = map.project([lat - latR, lng]),
                    p = top.add(bottom).divideBy(2),
                    lat2 = map.unproject(p).lat,
                    lngR = Math.acos((Math.cos(latR * d) - Math.sin(lat * d) * Math.sin(lat2 * d)) /
                        (Math.cos(lat * d) * Math.cos(lat2 * d))) / d;

                if (isNaN(lngR) || lngR === 0) {
                    lngR = latR / Math.cos(Math.PI / 180 * lat); // Fallback for edge case, #2425
                }

                this._point = p.subtract(map.getPixelOrigin());
                this._radius[key] = isNaN(lngR) ? 0 : Math.max(Math.round(p.x - map.project([lat2, lng - lngR]).x), 1);

            } else {
                var latlng2 = crs.unproject(crs.project(this._latlng).subtract([this._mRadius, 0]));

                this._point = map.latLngToLayerPoint(this._latlng);
                this._radius = this._point.x - map.latLngToLayerPoint(latlng2).x;
            }
        }

        this._updateBounds();
    },

    _updatePath: function () {
        this._renderer._updateQuadCircle(this);
    },
});
/**
 * @class LW.QuadCircle
 * @constructor
 * @param latlng {L.LatLng} 经纬度
 * @param options {object} 外部属性，可重设Properties
 * @returns {LW.QuadCircle}
 */
LW.quadCircle = function (latlng,options) {
    return new LW.QuadCircle(latlng,options);
};

/**
 * @module Geometry
 */
L.SVG.include ({
    _updateEllipse: function (layer) {
        var c = layer._point,
            rx = layer._radiusX,
            ry = layer._radiusY,
            phi = layer._tiltDeg,
            endPoint = layer._endPointParams;

        var d = 'M' + endPoint.x0 + ',' + endPoint.y0 +
            'A' + rx + ',' + ry + ',' + phi + ',' +
            endPoint.largeArc + ',' + endPoint.sweep + ',' +
            endPoint.x1 + ',' + endPoint.y1 + ' z';
        this._setPath(layer, d);
    }
});

L.Canvas.include ({
    _updateEllipse: function (layer) {
        if (layer._empty()) { return; }

        var p = layer._point,
            ctx = this._ctx,
            r = layer._radiusX,
            s = (layer._radiusY || r) / r;

        this._drawnLayers[layer._leaflet_id] = layer;

        ctx.save();

        ctx.translate(p.x, p.y);
        if (layer._tilt !== 0) {
            ctx.rotate( layer._tilt );
        }
        if (s !== 1) {
            ctx.scale(1, s);
        }

        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.restore();

        this._fillStroke(ctx, layer);
    },
});
/**
 * 椭圆形
 *
 * Features :
 *
 * Update Note：
 *      + v1.3.0-dev ：Created
 *
 * @class LW.Ellipse
 * @extends L.Path
 * @demo demo/geometry/ellipse.html
 */
LW.Ellipse = L.Path.extend({

    options: {
        fill: true,
        startAngle: 0,
        endAngle: 359.9
    },

    initialize: function (latlng, radii, tilt, options) {

        L.setOptions(this, options);
        this._latlng = L.latLng(latlng);

        if (tilt) {
            this._tiltDeg = tilt;
        } else {
            this._tiltDeg = 0;
        }

        if (radii) {
            this._mRadiusX = radii[0];
            this._mRadiusY = radii[1];
        }
    },

    setRadius: function (radii) {
        this._mRadiusX = radii[0];
        this._mRadiusY = radii[1];
        return this.redraw();
    },

    getRadius: function () {
        return new L.point(this._mRadiusX, this._mRadiusY);
    },

    setTilt: function (tilt) {
        this._tiltDeg = tilt;
        return this.redraw();
    },

    getBounds: function () {
        // TODO respect tilt (bounds are too big)
        var lngRadius = this._getLngRadius(),
            latRadius = this._getLatRadius(),
            latlng = this._latlng;

        return new L.LatLngBounds(
            [latlng.lat - latRadius, latlng.lng - lngRadius],
            [latlng.lat + latRadius, latlng.lng + lngRadius]);
    },

    // @method setLatLng(latLng: LatLng): this
    // Sets the position of a circle marker to a new location.
    setLatLng: function (latlng) {
        this._latlng = L.latLng(latlng);
        this.redraw();
        return this.fire('move', {latlng: this._latlng});
    },

    // @method getLatLng(): LatLng
    // Returns the current geographical position of the circle marker
    getLatLng: function () {
        return this._latlng;
    },

    setStyle: L.Path.prototype.setStyle,

    _project: function () {
        var lngRadius = this._getLngRadius(),
            latRadius = this._getLatRadius(),
            latlng = this._latlng,
            pointLeft = this._map.latLngToLayerPoint([latlng.lat, latlng.lng - lngRadius]),
            pointBelow = this._map.latLngToLayerPoint([latlng.lat - latRadius, latlng.lng]);

        this._point = this._map.latLngToLayerPoint(latlng);
        this._radiusX = Math.max(this._point.x - pointLeft.x, 1);
        this._radiusY = Math.max(pointBelow.y - this._point.y, 1);
        this._tilt = Math.PI * this._tiltDeg / 180;
        this._endPointParams = this._centerPointToEndPoint();
        this._updateBounds();
    },

    _updateBounds: function () {
        // http://math.stackexchange.com/questions/91132/how-to-get-the-limits-of-rotated-ellipse
        var sin = Math.sin(this._tilt);
        var cos = Math.cos(this._tilt);
        var sinSquare = sin * sin;
        var cosSquare = cos * cos;
        var aSquare = this._radiusX * this._radiusX;
        var bSquare = this._radiusY * this._radiusY;
        var halfWidth = Math.sqrt(aSquare*cosSquare+bSquare*sinSquare);
        var halfHeight = Math.sqrt(aSquare*sinSquare+bSquare*cosSquare);
        var w = this._clickTolerance();
        var p = [halfWidth + w, halfHeight + w];
        this._pxBounds = new L.Bounds(this._point.subtract(p), this._point.add(p));
    },

    _update: function () {
        if (this._map) {
            this._updatePath();
        }
    },

    _updatePath: function () {
        this._renderer._updateEllipse(this);
    },

    _getLatRadius: function () {
        return (this._mRadiusY / 40075017) * 360;
    },

    _getLngRadius: function () {
        return ((this._mRadiusX / 40075017) * 360) / Math.cos((Math.PI / 180) * this._latlng.lat);
    },

    _centerPointToEndPoint: function () {
        var c = this._point,
            rx = this._radiusX,
            ry = this._radiusY,
            theta2 = (this.options.startAngle + this.options.endAngle) * (Math.PI / 180),
            theta1 = this.options.startAngle * (Math.PI / 180),
            delta = this.options.endAngle,
            phi = this._tiltDeg * (Math.PI / 180);

        // Determine start and end-point coordinates
        var x0 = c.x + Math.cos(phi) * rx * Math.cos(theta1) +
            Math.sin(-phi) * ry * Math.sin(theta1);
        var y0 = c.y + Math.sin(phi) * rx * Math.cos(theta1) +
            Math.cos(phi) * ry * Math.sin(theta1);

        var x1 = c.x + Math.cos(phi) * rx * Math.cos(theta2) +
            Math.sin(-phi) * ry * Math.sin(theta2);
        var y1 = c.y + Math.sin(phi) * rx * Math.cos(theta2) +
            Math.cos(phi) * ry * Math.sin(theta2);

        var largeArc = (delta > 180) ? 1 : 0;
        var sweep = (delta > 0) ? 1 : 0;

        return {'x0': x0, 'y0': y0, 'tilt': phi, 'largeArc': largeArc,
            'sweep': sweep, 'x1': x1, 'y1': y1};
    },

    _empty: function () {
        return this._radiusX && this._radiusY && !this._renderer._bounds.intersects(this._pxBounds);
    },

    _containsPoint : function (p) {
        var sin = Math.sin(this._tilt);
        var cos = Math.cos(this._tilt);
        var dx = p.x - this._point.x;
        var dy = p.y - this._point.y;
        var sumA = cos * dx + sin * dy;
        var sumB = sin * dx - cos * dy;
        return sumA * sumA / (this._radiusX * this._radiusX)  + sumB * sumB / (this._radiusY * this._radiusY) <= 1;
    }
});
/**
 * @class LW.Ellipse
 * @constructor
 * @param latlng {L.LatLng} 经纬度
 * @param radii {Array} 半径
 * @param tilt {number} 倾斜角度
 * @param options {object} 外部属性，可重设Properties
 * @returns {LW.Ellipse}
 */
LW.ellipse = function (latlng, radii, tilt, options) {
    return new LW.Ellipse(latlng, radii, tilt, options);
};

(function(){
    var labelInclude = {
        options:{
            /**
             * 文本颜色
             * @property textColor
             * @type {string}
             * @default '#333'
             */
            textColor:'#333',
            /**
             * 文本字号
             * @property fontSize
             * @type {number}
             * @default 16
             */
            fontSize:16,
            /**
             * 文本加粗
             * @property fontWeight
             * @type {string}
             * @default 'bold'
             */
            fontWeight:'bold',
            /**
             * 文本描边
             * @property textStroke
             * @type {string}
             * @default 'none'
             */
            textStroke:'none',
            /**
             * 文本偏移量
             * @property textOffset
             * @type {L.Point}
             * @default L.point(0,0)
             */
            textOffset: L.point(0,0)
        },

        onAdd: function () {
            this._renderer._initText(this);
            L.Path.prototype.onAdd.call(this);
            this._renderer._addText(this);
        },

        onRemove: function () {
            this._renderer._removeText(this);
            L.Path.prototype.onRemove.call(this);
        },

        _updateText:function () {
            var latlng = this.getCenter();
            if(latlng instanceof L.LatLng){
                var textPos = this._map.latLngToLayerPoint(latlng);
                textPos = textPos.add(this.options.textOffset);
                this._renderer._updateText(this,textPos,this.value);
            }
        },

        setValue:function (value) {
            this.value = value;
            this._updateText();
        }
    };


    /**
     * 带标注的矩形
     *
     * Features :
     *      1. 带标注的矩形
     *
     * Update Note：
     *      + v1.5.2 ：Created
     *
     * @class LW.LabelRect
     * @extends L.Rectangle
     * @demo demo/geometry/labelGeometry.html  {带文本的几何体}
     */
    LW.LabelRect = L.Rectangle.extend(L.extend({}, labelInclude, {
        initialize: function (latLngBounds, options,value) {
            L.Rectangle.prototype.initialize.call(this, latLngBounds, options);
            this.value = value || '';
        },

        _update: function () {
            if (!this._map) { return; }
            L.Rectangle.prototype._update.call(this);
            this._updateText();
        },
    }));

    /**
     * @class LW.LabelRect
     * @constructor
     * @param latLngBounds {L.LatLngBounds}
     * @param options {object} 外部属性，可重设Properties
     * @param value {string}
     * @returns {LW.LabelRect}
     */
    LW.labelRect = function (latLngBounds, options, value) {
        return new LW.LabelRect(latLngBounds, options, value);
    };


    /**
     * 带标注的圆形
     *
     * Features :
     *      1. 带标注的圆形
     *
     * Update Note：
     *      + v1.5.2 ：Created
     *
     * @class LW.LabelCircle
     * @extends L.Circle
     * @demo demo/geometry/labelGeometry.html  {带文本的几何体}
     */
    LW.LabelCircle = L.Circle.extend(L.extend({}, labelInclude, {
        initialize: function (latlng, options,value) {
            L.Circle.prototype.initialize.call(this, latlng, options);
            this.value = value || '';
        },

        _update: function () {
            if (!this._map) { return; }
            L.Circle.prototype._update.call(this);
            this._updateText();
        },

        getCenter: function () {
            return this._latlng;
        }
    }));

    /**
     * @class LW.LabelCircle
     * @constructor
     * @param latlng {L.LatLng}
     * @param options {object} 外部属性，可重设Properties
     * @param value {string}
     * @returns {LW.LabelCircle}
     */
    LW.labelCircle = function (latlng, options, value) {
        return new LW.LabelCircle(latlng, options, value);
    };

})();

/**
 *
 * @module Layer.Plot.Contour
 */
/**
 * 色斑图模型
 *
 * Features :
 *      1. 自动站点绘制色斑图的信息模型
 *      2. 网格信息、图例信息等
 *
 * Update Note：
 *      + v1.0.0 ：Created
 *      + v1.4.0 ：增加根据经纬度获取最近网格的行列的方法，增加根据行列获取网格值的方法
 *
 *
 * @class LW.ContourModel
 * @extends L.Class
 */
LW.ContourModel = L.Class.extend({

    options:{
        /**
         * 参与插值的离散点最少数量
         * @property iPointMinNum
         * @type {int}
         * @default 3
         */
        iPointMinNum: 3,
        /**
         * 插值指数，离散点的比重的指数
         * @property pow
         * @type {int}
         * @default 5
         */
        pow: 5,
        /**
         * 查找的最大行数
         * @property seekMaxRow
         * @type {int}
         * @default 50
         */
        seekMaxRow:50,
        /**
         * 查找的最列数
         * @property seekMaxColumn
         * @type {int}
         * @default 50
         */
        seekMaxColumn:50,

        method:'idw',//idw/kriging/rbf

        latField:'STATIONLAT',
        lonField:'STATIONLON'
    },

    /**
     * 网格列数(越大则性能越差，但插值会更准确)
     * @property columns
     * @type {int}
     * @default 50
     */
    columns: 50,
    /**
     * 网格行数(越大则性能越差，但插值会更准确)
     * @property rows
     * @type {int}
     * @default 50
     */
    rows: 50,

    /**
     * 起止经纬构成的范围
     *
     * @property bounds
     * @type {L.LatLngBounds}
     * @default null
     */
    bounds: null,

    /**
     * 单元纬度间隔
     * @property cellLatRange
     * @type {number}
     * @default NaN
     */
    cellLatRange: NaN,

    /**
     * 单元经度间隔
     * @property cellLngRange
     * @type {number}
     * @default NaN
     */
    cellLngRange: NaN,

    /**
     * 图例数据
     * @property legendData
     * @type {Array}
     * @default null
     */
    legendData: null,

    /**
     * 等级模式（若图例数据不是等间隔，可用等级模式来平衡数值，从而平衡等值面的大小）
     *
     * eg:降水图例一般需要用等级模式
     * @property levelMode
     * @type {Boolean}
     * @default false
     */
    levelMode: false,

    /**
     * 网格模型数据
     */
    grid: [],

    initialize: function (options) {
        L.setOptions(this,options);

        // this.bounds = bounds;
        // this.columns = columns || this.columns;
        // this.rows = rows || this.rows;
        // this.legendData = legendData || this.legendData;
        //this._buildGrid();

        this.gridInterpolate = new LW.GridInterpolate(this);
        this.tracker = new LW.Tracker(this);
        this.tinter = new LW.Tinter({editable: this.options.editable});
    },

    setGridBounds:function(bounds, rows, columns){
        this.bounds = bounds;
        this.rows = rows || this.rows;
        this.columns = columns || this.columns;
    },

    buildGrid: function () {
        // 建立初始网格
        this.setGridByData();
        // this.grid = [];
        // var rows = this.rows,
        //     columns = this.columns;
        // for (var i = 0; i < rows; i++) {
        //     for (var j = 0; j < columns; j++) {
        //         this.grid.push({gridValue: NaN, valuePoints: [], interpolatePoints: []});
        //     }
        // }

        // 计算单元经纬度间隔
        var bounds = this.bounds;
        if (Sun.Util.Common.isValid(bounds) && (bounds instanceof L.LatLngBounds)) {
            var latRange = bounds.getNorth() - bounds.getSouth();
            var lngRange = bounds.getEast() - bounds.getWest();
            this.cellLatRange = latRange / (this.rows - 1);
            this.cellLngRange = lngRange / (this.columns - 1);
        }
    },

    /**
     * 在网格最外层扩展一层图例最小值，用于跟踪时避免开曲线问题
     *
     * 外部可通过s_grid引用这个被扩展的网格数据
     * @method spreadGrid
     */
    spreadGrid: function () {
        if (!isNaN(this.minValue)) {
            var s_value = -9999;
            if(this.legendData){
                for (var m = 0; m < this.legendData.length; m++) {
                    if (this.legendData[m].min > this.minValue) {
                        var item = this.legendData[m - 1] || this.legendData[m];
                        s_value = isNaN(item.min)?s_value:item.min - 0.01;
                        break;
                    }
                }
            }

            var s_rows = this.s_rows;
            var s_columns = this.s_columns;
            for (var i = 0; i < s_rows; i++) {
                for (var j = 0; j < s_columns; j++) {
                    if(i===0 || i===s_rows-1 || j===0 || j===s_columns-1)
                        this.s_grid[i * s_columns + j].gridValue=s_value;
                }
            }
        }

        // this.s_grid = Sun.Util.Data.deepClone(this.grid);
        // this.s_grid = this.grid.concat();
        // var columns = this.columns,rows = this.rows;
        // var s = [];
        // for (var i = 0; i < columns; i++) {
        //     s.push({gridValue: s_value});
        //     // this.s_grid.unshift({gridValue: s_value});
        //     // this.s_grid.push({gridValue: s_value});
        // }
        // this.s_grid = s.concat(this.s_grid).concat(s);
        //
        // var d3 = new Date().getTime();
        // var s_rows = this.s_rows = rows + 2;
        // var s_columns = this.s_columns = columns + 2;
        // for (i = 0; i < s_rows; i++) {
        //     // TODO:splice太耗性能，需优化,优化成一开始则扩展网格
        //     this.s_grid.splice(i * s_columns, 0, {gridValue: s_value});
        //     this.s_grid.splice((i + 1) * s_columns - 1, 0, {gridValue: s_value});
        // }
        // var d4 = new Date().getTime();
        // console.log('tx：',(d4-d3)/1000+'s');
    },

    setGridByData:function (data,fixValue) {
        this.grid = [];
        this.s_grid = [];
        var s_value = -9999.01,minValue = 9999,maxValue = -9999;

        // 建立初始网格
        var rows = this.rows,
            columns = this.columns;
        var s_rows = this.s_rows = rows + 2;
        var s_columns = this.s_columns = columns + 2;
        for (var i = 0; i < s_rows; i++) {
            for (var j = 0; j < s_columns; j++) {
                var idx = i * s_columns + j;
                if(i===0 || i===s_rows-1 || j===0 || j===s_columns-1)
                    this.s_grid[idx] = {gridValue: s_value, valuePoints: [], interpolatePoints: []};
                else{
                    var value = NaN;
                    if(data){
                        value = data.data[(i-1)*columns+(j-1)];
                        if(value != data.invalidValue){
                            minValue = minValue>value ? value : minValue;
                            maxValue = maxValue<value ? value : maxValue;
                        }
                        else if(value == data.invalidValue)
                            value = fixValue || s_value;
                    }
                    var item = {gridValue: value, valuePoints: [], interpolatePoints: []};
                    this.grid.push(item);
                    this.s_grid[idx] = item;
                }
            }
        }
        this.minValue = minValue;
        this.maxValue = maxValue;
    },

    /**
     * 获取扩展网格的单元格
     * @method getCell_S
     * @param row
     * @param column
     * @returns {T|*}
     */
    getCell_S: function (row, column) {
        return this.s_grid[row * this.s_columns + column];

    },


    /**
     * 获取扩展网格的指定网格点的经纬
     * @method getCellLatLng_S
     * @param row
     * @param column
     */
    getCellLatLng_S: function (row, column) {
        return this.getCellLatLng(row - 1, column - 1);
    },

    /**
     * 获取单元格
     * @method getCell
     * @param row
     * @param column
     * @returns {*}
     */
    getCell: function (row, column) {
        return this.grid[row * this.columns + column];
    },

    /**
     * 获取指定网格点的经纬
     * @method getCellLatLng
     * @param row
     * @param column
     */
    getCellLatLng: function (row, column) {
        var bounds = this.bounds;
        return L.latLng(bounds.getSouth() + this.cellLatRange * row, bounds.getWest() + this.cellLngRange * column);
    },

    getClosestGridByLatlng:function (latlng) {
        if(this.bounds){
            var x0 = this.bounds.getWest(), y0 = this.bounds.getSouth();
            var dx = this.cellLngRange, dy = this.cellLatRange;
            var row = (latlng.lat - y0) / dy;
            var column = (latlng.lng - x0) / dx;
            return {row:Math.round(row),column:Math.round(column)};
        }
    },

    inGrid:function (row,column) {
        return row>=0 && row<this.rows && column>=0 && column<this.columns;
    },

    /**
     * 根据所给的row，column获得指向的格点
     * @method getGrid
     * @param row {int}
     * @param column {int}
     * @returns {boolean}
     */
    getGrid:function (row,column) {
        return this.inGrid(row,column)?this.getCell(row,column).gridValue : null;
    },

    /**
     * 遍历所有格点
     * @method eachGrid
     * @param fun {Function} 回调
     * @param context {LW.GridModel} this
     */
    eachGrid:function (fun, context) {
        for(var row_i=0,i=0;row_i<context.rows;row_i++){
            for(var column_i=0;column_i<context.columns;column_i++,i++){
                fun(context,row_i,column_i,i);
            }
        }
    },

    /**
     * 获取离散点（将站点数据整合成简单的结构）
     * @param source
     * @param valueField
     * @param valueScale
     * @returns {Array}
     */
    getDiscreteData: function (source, valueField, valueScale) {
        var discreteData = [];
        var data = source.FieldName?source.Rows:source;
        var bounds = this.bounds;
        valueScale = valueScale || 1;
        for (var i = 0; i < data.length; i++) {
            var item = data[i];
            var value = Sun.Util.Data.getValueByField(item,valueField,source.FieldName);
            var lat = Sun.Util.Data.getValueByField(item,this.options.latField,source.FieldName);
            var lng = Sun.Util.Data.getValueByField(item,this.options.lonField,source.FieldName);
            if (!isNaN(value) && value != null && lat != '' && lng != '' && bounds.contains([lat,lng])) {
                var dValue = this.levelMode ? getSectionIndex(this.legendData, value) : (value * valueScale);
                var dItem = {lat: lat, lng: lng, value: dValue};
                discreteData.push(dItem);
            }
        }
        return discreteData;

        function getSectionIndex(legendData, value) {
            for (var i = 0; i < legendData.length; i++) {
                var item = legendData[i];
                if ((isNaN(item.max) || value < item.max || (item.equalMax && value == item.max))
                    && (isNaN(item.min) || value > item.min) || (item.equalMin && value == item.min))
                    return i;
            }
            return -1;
        }
    },

    /**
     * 插值
     * @param discreteData
     */
    interpolate:function (discreteData) {
        this.gridInterpolate.interpolate(discreteData);
    },

    /**
     * 获取格点值数据
     * @method getGridValueData
     * @returns {{data: Array, startlon: *, startlat: *, endlon: *, endlat: *, nlon: (number|*), nlat: (number|*), lonsize: (int|Array|*), latsize: (int|SQLResultSetRowList|Number|HTMLCollection|string)}}
     */
    getGridValueData: function () {
        var bounds = this.bounds;
        return {
            data: this.grid.map(function (item) {
                return item.gridValue
            }),
            startlon: bounds.getWest(), startlat: bounds.getSouth(),
            endlon: bounds.getEast(), endlat: bounds.getNorth(),
            nlon: this.cellLngRange, nlat: this.cellLatRange,
            lonsize: this.columns, latsize: this.rows
        };
    },

    /**
     * 获取等值线数据
     * @returns {*}
     */
    getIsolineData: function (gap) {
        return this.tracker.getIsolineData(gap);
    },

    /**
     * 获取面数据
     * @param isolineData
     * @returns {*|Array}
     */
    getPlaneData: function (isolineData) {
        return this.tinter.getPlaneData(this.legendData,isolineData);
    },

    /**
     * 用站点数据获取色斑图数据
     * @param zdzData
     * @param valueField
     * @param legendData
     * @return {*|{data: Array, startlon: *, startlat: *, endlon: *, endlat: *, nlon: (number), nlat: (number), lonsize: (int), latsize: (int)}}
     */
    getContourDataOfZdz: function (zdzData, valueField, legendData) {
        var discreteData = this.discreteData;
        if(zdzData){
            this.legendData = legendData;
            discreteData = this.discreteData = this.getDiscreteData(zdzData, valueField,this.options.valueScale);
        }

        // tip: 因离散点数量小于最小离散点数不能有效插值
        if (discreteData && discreteData.length >= this.options.iPointMinNum) {
            // 插值
            this.interpolate(discreteData);
            var data = this.getGridValueData();
            // 跟踪
            var isolineData = this.getIsolineData();
            data.lineitems = isolineData;
            // 填色
            data.planeitems = this.getPlaneData(isolineData);
            return data;
        }
    },

    /**
     * 获取格点数据的色斑图数据
     * @param data
     * @param legendData {array|function} 图例数据，或根据minValue/maxValue可返回图例数据的方法
     * @return {*}
     */
    getContourDataOfGrid: function (data, legendData) {
        var bound = L.latLngBounds([data.endlat, data.startlon], [data.startlat, data.endlon]);
        this.setGridBounds(bound,data.latsize,data.lonsize);
        this.cellLatRange = data.nlat;
        this.cellLngRange = data.nlon;
        this.setGridByData(data);
        this.legendData = typeof legendData == "function" ? legendData(this.minValue,this.maxValue) : legendData;
        // 跟踪
        var isolineData = this.getIsolineData();
        data.lineitems = isolineData;
        // 填色
        data.planeitems = this.getPlaneData(isolineData);
        return data;
    },

    /**
     * 获取图表网格的色斑图数据
     * @param data
     * @param field
     * @param legendData
     * @param fill
     * @param gap
     * @return {*}
     */
    setContourDataOfChartGrid: function (data, field, legendData, fill,gap) {
        var bound = L.latLngBounds([0, 0], [data.xaxis.length-1,data.yaxis.length-1]);
        this.setGridBounds(bound,data.yaxis.length,data.xaxis.length);
        this.legendData = legendData;
        this.cellLatRange = 1;
        this.cellLngRange = 1;
        this.setGridByData(data.data[field],-9999);
        // 跟踪
        var isolineData = this.getIsolineData(gap);
        data.data[field].lineitems = isolineData;

        if(fill)// 填色
            data.data[field].planeitems = this.getPlaneData(isolineData);
        return data;
    }
});

/**
 *
 * @module Layer.Plot.Contour
 */
/**
 * 站点插值成格点数据
 *
 * Features :
 *      1. 暂只支持反距离加权法插值
 *      2. 插值后网格信息存储于contourModel中
 *
 *
 * @class LW.GridInterpolate
 * @extends L.Class
 */
LW.GridInterpolate = L.Class.extend({

    options: {
    },

    initialize: function (contourModel, options) {
        L.setOptions(this, options);
        this.contourModel = contourModel;
    },

    /**
     * 插值
     * @method interpolate
     * @param data {Array|rbus} 离散点数据 eg:[{lat:25.06,lng:112.23:value:10}]
     */
    interpolate: function (data) {
        var cModel = this.contourModel,method = cModel.options.method;

        cModel.buildGrid();// 创建网格
        var minItem = Sun.Util.Array.getMinValObject(data, 'value');
        cModel.minValue = minItem.value;// 根据离散数据，设置网格模型最小值

        if(method=='idw'){
            var d1 = new Date().getTime();
            // 填充各个网格对应的离散点
            this._fillValuePoints(data);

            // 插值
            this._IDWInterpolate();
            // var d2 = new Date().getTime();
            // console.log('插值:',(d2-d1)/1000+'s');
        }
        else if(method=='kriging'){
            var t = data.map(function(d){ return d.value; });
            var x = data.map(function(d){ return d.lng; });
            var y = data.map(function(d){ return d.lat; });
            this.variogram = this._getVariogram(t,x,y,Math.sqrt(data.length));
            // 插值
            this._KrigingInterpolate();
        }
        else if(method=='rbf'){
            var data = [];
            // 清除离散点数据中经纬度重合的点
            for(var i=0;i<data.length;i++){
                var item1 = data[i],single = true;
                for(var j=i+1;j<data.length;j++){
                    var item2 = data[j];
                    if(item1.lat==item2.lat && item1.lng==item2.lng)
                        single=false;
                }
                if(single)
                    data.push(item1);
            }
            var values = data.map(function(d){ return d.value; });
            var points = data.map(function(d){ return [d.lng,d.lat]; });
            this.rbf = RBF(points, values);
            this._RBFInterpolate();
        }
    },

    _fillValuePoints:function (discreteData) {
        var bounds = this.contourModel.bounds;
        // 填充各个网格对应的离散点
        for (var i = 0; i < discreteData.length; i++) {
            var item = discreteData[i];
            var row = parseInt((item.lat - bounds.getSouth()) / this.contourModel.cellLatRange);
            var column = parseInt((item.lng - bounds.getWest()) / this.contourModel.cellLngRange);
            if (row < 0 || column < 0 || row > this.contourModel.rows - 1 || column > this.contourModel.columns - 1)
                continue;
            var cell = this.contourModel.getCell(row, column);
            cell.valuePoints.push(item);
        }
    },

    _getVariogram:function (t,x,y,alpha) {
        var model = "exponential";
        var sigma2 = 0;
        return kriging.train(t, x, y, model,sigma2,alpha);
    },

    /**
     * 径向基函数插值
     * @private
     */
    _RBFInterpolate:function () {
        var rows = this.contourModel.rows,
            columns = this.contourModel.columns;
        for (var i = 0; i < rows; i++) {
            for (var j = 0; j < columns; j++) {
                var cell = this.contourModel.getCell(i, j);
                var cellLatlng = this.contourModel.getCellLatLng(i, j);
                cell.gridValue = this.rbf([cellLatlng.lng, cellLatlng.lat]);
            }
        }
    },

    /**
     * 克里金插值
     * @private
     */
    _KrigingInterpolate: function () {
        var rows = this.contourModel.rows,
            columns = this.contourModel.columns;
        for (var i = 0; i < rows; i++) {
            for (var j = 0; j < columns; j++) {
                var cell = this.contourModel.getCell(i, j);
                var cellLatlng = this.contourModel.getCellLatLng(i, j);
                cell.gridValue = kriging.predict(cellLatlng.lng, cellLatlng.lat, this.variogram);
            }
        }
    },

    /**
     * 反距离加权插值
     */
    _IDWInterpolate: function () {

        var d, v, w, sum_d, e = 0.000001;
        var cModel = this.contourModel;

        var rows = cModel.rows,columns = cModel.columns;
        for (var i = 0; i < rows; i++) {
            for (var j = 0; j < columns; j++) {
                v = 0;
                w = 0;
                sum_d = 0;
                var cell = cModel.getCell(i, j);
                var cellLatlng = cModel.getCellLatLng(i, j);

                // 查找参与插值的离散点
                this._seekIPoints(cell, i - 1, i, j - 1, j);

                var iPointNum = cell.interpolatePoints.length;
                // 权重数据
                var sgData = [];
                for (var k = 0; k < iPointNum; k++) {
                    var p = cell.interpolatePoints[k];
                    // d = cellLatlng.distanceTo(L.latLng(p.lat, p.lng));
                    d = Math.sqrt(Math.pow(cellLatlng.lat - p.lat,2)+Math.pow(cellLatlng.lng - p.lng,2));
                    if (d < e) {
                        cell.gridValue = parseFloat(p.value);
                        break;
                    }
                    else {
                        //d = Math.pow(1/d,this.options.pow);
                        //v += p.value * d;
                        //w += d;

                        var pd = Math.pow(1/d, cModel.options.pow);
                        // var pd = getPd(1/d);
                        sgData.push({d: pd, value: p.value});
                        w += pd;
                    }
                }

                if (isNaN(cell.gridValue)) {
                    var value = 0;
                    for (var s = 0; s < sgData.length; s++) {
                        var sg = sgData[s];
                        value += sg.d / w * sg.value;
                    }
                    cell.gridValue = parseFloat(Sun.Util.Math.toFixed(value, 2));
                }
                //cell.gridValue = MathUtil.toFixed(v/w, 2);

            }
        }

        function getPd(_d) {
            return _d*_d*_d*_d*_d;
        }
    },

    _seekIPoints: function (cell, startRow, endRow, startColumn, endColumn) {
        var cModel = this.contourModel;
        //行列范围设定
        startRow = startRow < 0 ? 0 : startRow;
        endRow = endRow > cModel.rows - 1 ? (cModel.rows - 1) : endRow;
        startColumn = startColumn < 0 ? 0 : startColumn;
        endColumn = endColumn > cModel.columns - 1 ? (cModel.columns - 1) : endColumn;

        var rs = endRow - startRow + 1;
        var cs = endColumn - startColumn + 1;

        // if(rs > cModel.options.seekMaxRow || cs > cModel.options.seekMaxColumn)
        //     return;
        if (rs == 1 && cs == 1 && !(startRow == 0 && endRow == 0 && startColumn == 0 && endColumn == 0))
            return;


        //小于或等于4格
        if (cs * rs <= 4) {
            for (var i = startRow; i <= endRow; i++) {
                for (var j = startColumn; j <= endColumn; j++) {
                    var iCell = cModel.getCell(i, j);
                    if (iCell.valuePoints.length > 0)
                        cell.interpolatePoints = cell.interpolatePoints.concat(iCell.valuePoints);
                }
            }
        }
        else {
            //上部
            for (i = startColumn; i <= endColumn - 1; i++) {
                iCell = cModel.getCell(startRow, i);
                if (iCell.valuePoints.length > 0)
                    cell.interpolatePoints = cell.interpolatePoints.concat(iCell.valuePoints);
            }
            //左部
            for (i = startRow + 1; i <= endRow; i++) {
                iCell = cModel.getCell(i, startColumn);
                if (iCell.valuePoints.length > 0)
                    cell.interpolatePoints = cell.interpolatePoints.concat(iCell.valuePoints);
            }
            //右部
            for (i = startRow; i <= endRow - 1; i++) {
                iCell = cModel.getCell(i, endColumn);
                if (iCell.valuePoints.length > 0)
                    cell.interpolatePoints = cell.interpolatePoints.concat(iCell.valuePoints);
            }
            //下部
            for (i = startColumn + 1; i <= endColumn; i++) {
                iCell = cModel.getCell(endRow, i);
                if (iCell.valuePoints.length > 0)
                    cell.interpolatePoints = cell.interpolatePoints.concat(iCell.valuePoints);
            }
        }

        if (cell.interpolatePoints.length < cModel.options.iPointMinNum)
            this._seekIPoints(cell, startRow - 1, endRow + 1, startColumn - 1, endColumn + 1);
        else
            return;
    }
});

/**
 *
 * @module Layer.Plot.Contour
 */
/**
 * 格点数据跟踪出等值线数据
 *
 * Features :
 *      1. 查找出所有的等值点，再遍历网格跟踪
 *      2. 跟踪出等值线信息
 *
 *
 * @class LW.Tracker
 * @extends L.Class
 */
LW.Tracker = L.Class.extend({
    options: {},

    // 修正差值
    d_value: 0.1,

    // 对比精度
    precision: 0.0001,

    /**
     *
     * @param contourModel {ContourModel} 网格模型
     * @param options
     */
    initialize: function (contourModel, options) {
        L.setOptions(this, options);
        this.contourModel = contourModel;
    },

    /**
     * 获取等值线数据
     * @method getIsolineData
     * @param gap {int} 插值的间隔,如果有间隔，优先用间隔插值
     * @returns {*}
     */
    getIsolineData: function (gap) {
        // 在格点值最外层加入一层图例的最小值
        // this.contourModel.spreadGrid();

        // 寻找等值点，并填充于格点模型中
        var d1 = new Date().getTime();
        var legendData = this.contourModel.legendData;
        var min = this.contourModel.minValue,max = this.contourModel.maxValue;
        var i_min,i_max;
        if(gap){
            i_min = Math.floor(min/gap);
            i_max = Math.ceil(max/gap);
        }
        else{
            i_min = Sun.Util.LegendData.getColorIndex(legendData,min);
            i_max = Sun.Util.LegendData.getColorIndex(legendData,max);
            i_min = i_min>0 ? i_min - 1 : 0;
            i_max = i_max>0 ? i_max + 1 : legendData.length;
        }
        for (var i = i_min; i < i_max; i++) {
            var value = gap?i*gap:legendData[i].min;
            value = isNaN(value) || value == null ? -9999 : value;
            this._seekSameValuePoint(value);
        }
        // var d2 = new Date().getTime();
        // console.log('寻找等值点:',(d2-d1)/1000+'s');

        var data = this._track();
        // var d3 = new Date().getTime();
        // console.log('跟踪:',(d3-d2)/1000+'s');
        // 跟踪
        return data;
    },

    /**
     * 寻找等值点
     * @param value
     * @private
     */
    _seekSameValuePoint: function (value) {
        if (isNaN(value))
            return;

        var gridModel = this.contourModel;
        var rows = gridModel.s_rows;
        var columns = gridModel.s_columns;

        for (var i = 0; i < rows; i++) {
            for (var j = 0; j < columns; j++) {
                var cell = this.contourModel.getCell_S(i, j);
                var x_cell = j === columns - 1 ? null : this.contourModel.getCell_S(i, j + 1);
                var y_cell = i === rows - 1 ? null : this.contourModel.getCell_S(i + 1, j);
                var v0 = cell.gridValue, v1, flag, rate;
                var latlng = this.contourModel.getCellLatLng_S(i, j);
                if (x_cell) {
                    v1 = x_cell.gridValue;
                    var lng = NaN;
                    flag = (value - v0) * (value - v1);
                    if (flag < 0)
                        lng = latlng.lng + (v0 - value) / (v0 - v1) * this.contourModel.cellLngRange;
                    else if (flag === 0) {
                        //if((value-v0)<this.precision && (value-v0)>-this.precision)
                        if (Math.abs(value - v0) < this.precision)
                            v0 += this.d_value;
                        else
                            v1 += this.d_value;
                        rate = (value - v0) / (v1 - v0);
                        if (rate > 0 && rate < 1) {
                            lng = latlng.lng + rate * this.contourModel.cellLngRange;
                        }
                    }
                    if (!isNaN(lng)) {
                        cell.x_isoPoints = cell.x_isoPoints || [];
                        cell.x_isoPoints.push({value: value, latlng: [latlng.lat, lng]});
                        // var n_marker=LW.nameMarker([latlng.lat,lng],{iconOptions:{radius: 3,color: '#f00',iconType: 'graph'}}).addTo(map);
                        // n_marker.options.icon.setData([],value);
                    }
                }
                v0 = cell.gridValue;
                if (y_cell) {
                    v1 = y_cell.gridValue;
                    var lat = NaN;
                    flag = (value - v0) * (value - v1);
                    if (flag < 0)
                        lat = latlng.lat + (v0 - value) / (v0 - v1) * this.contourModel.cellLatRange;
                    else if (flag === 0) {
                        //if((value-v0)<this.precision && (value-v0)>-this.precision)
                        if (Math.abs(value - v0) < this.precision)
                            v0 += this.d_value;
                        else
                            v1 += this.d_value;
                        rate = (value - v0) / (v1 - v0);
                        if (rate > 0 && rate < 1) {
                            lat = latlng.lat + rate * this.contourModel.cellLatRange;
                        }
                    }
                    if (!isNaN(lat)) {
                        cell.y_isoPoints = cell.y_isoPoints || [];
                        cell.y_isoPoints.push({value: value, latlng: [lat, latlng.lng]});
                        // n_marker=LW.nameMarker([lat,latlng.lng],{iconOptions:{radius: 3,color: '#f00',iconType: 'graph'}}).addTo(map);
                        // n_marker.options.icon.setData([],value);
                    }
                }
            }
        }
    },

    /**
     * 跟踪
     */
    _track: function () {
        var contourModel = this.contourModel;
        var rows = contourModel.s_rows;
        var columns = contourModel.s_columns;

        var data = [];
        for (var i = 0; i < rows; i++) {
            for (var j = 0; j < columns; j++) {
                var cell = contourModel.getCell_S(i, j);
                var p0, t_value, line;
                trackLine(cell.x_isoPoints, 'top');
                trackLine(cell.y_isoPoints, 'left');
            }
        }

        // var data = this._fixData(data);

        return data;

        function trackLine(isoPoints, dir) {
            if (isoPoints) {
                for (var m = 0; m < isoPoints.length; m++) {
                    var p = isoPoints[m];
                    if (!p.tracked) {
                        p.tracked = true;
                        p0 = p.latlng;
                        t_value = p.value;
                        var iValue = contourModel.levelMode ? contourModel.legendData[p.value].min : p.value;
                        // var bounds = L.latLngBounds();
                        // bounds.extend(p0);
                        line = {linevalue: iValue, linetype: 1, pointitems: [p0]};
                        data.push(line);
                        trackCell(i, j, dir);
                    }
                }
            }

        }

        function trackCell(row, column, dir) {
            if (dir == 'top') {
                var cell = contourModel.getCell_S(row, column);
                var next_p = cell && cell.y_isoPoints ? Sun.Util.Array.getItemByField(cell.y_isoPoints, 'value', t_value) : null;
                if (closed(p0, next_p))
                    return true;
                // 先找本点y放向是否有等值点，有的话，加入线条
                if (addTrackPoint(next_p))
                    trackCell(row, column, "right");
                else {
                    // 若本点y没有等值点，再查找本点下一行的x方向是否有等值点
                    cell = contourModel.getCell_S(row + 1, column);
                    next_p = cell && cell.x_isoPoints ? Sun.Util.Array.getItemByField(cell.x_isoPoints, 'value', t_value) : null;
                    if (closed(p0, next_p))
                        return true;
                    if (addTrackPoint(next_p))
                        trackCell(row + 1, column, "top");
                    else {
                        // 若本点下一行的x方向无等值点，则查找本点下一列的y方向是否有等值点
                        cell = contourModel.getCell_S(row, column + 1);
                        next_p = cell && cell.y_isoPoints ? Sun.Util.Array.getItemByField(cell.y_isoPoints, 'value', t_value) : null;
                        if (closed(p0, next_p))
                            return true;
                        if (addTrackPoint(next_p))
                            trackCell(row, column + 1, "left");
                    }
                }
            }
            else if (dir == 'bottom') {
                cell = contourModel.getCell_S(row - 1, column);
                next_p = cell && cell.y_isoPoints ? Sun.Util.Array.getItemByField(cell.y_isoPoints, 'value', t_value) : null;
                if (closed(p0, next_p))
                    return true;
                // 查找本点上一行的y方向是否有等值点
                if (addTrackPoint(next_p))
                    trackCell(row - 1, column, "right");
                else {
                    // 查找本点上一行的x方向是否有等值点
                    next_p = cell && cell.x_isoPoints ? Sun.Util.Array.getItemByField(cell.x_isoPoints, 'value', t_value) : null;
                    if (closed(p0, next_p))
                        return true;
                    if (addTrackPoint(next_p))
                        trackCell(row - 1, column, "bottom");
                    else {
                        // 若本点上一行的x方向无等值点，则查找本点上一行下一列的y方向是否有等值点
                        cell = contourModel.getCell_S(row - 1, column + 1);
                        next_p = cell && cell.y_isoPoints ? Sun.Util.Array.getItemByField(cell.y_isoPoints, 'value', t_value) : null;
                        if (closed(p0, next_p))
                            return true;
                        if (addTrackPoint(next_p))
                            trackCell(row - 1, column + 1, "left");
                    }
                }
            }
            else if (dir == 'left') {
                cell = contourModel.getCell_S(row, column);
                next_p = cell && cell.x_isoPoints ? Sun.Util.Array.getItemByField(cell.x_isoPoints, 'value', t_value) : null;
                if (closed(p0, next_p))
                    return true;
                // 先找本点x方向是否有等值点，有的话，加入线条
                if (addTrackPoint(next_p))
                    trackCell(row, column, "bottom");
                else {
                    // 若本点x方向没有等值点，再查找本点下一行的x方向是否有等值点
                    cell = contourModel.getCell_S(row + 1, column);
                    next_p = cell && cell.x_isoPoints ? Sun.Util.Array.getItemByField(cell.x_isoPoints, 'value', t_value) : null;
                    if (closed(p0, next_p))
                        return true;
                    if (addTrackPoint(next_p))
                        trackCell(row + 1, column, "top");
                    else {
                        // 若本点下一行的x方向无等值点，则查找本点下一列的y方向是否有等值点
                        cell = contourModel.getCell_S(row, column + 1);
                        next_p = cell && cell.y_isoPoints ? Sun.Util.Array.getItemByField(cell.y_isoPoints, 'value', t_value) : null;
                        if (closed(p0, next_p))
                            return true;
                        if (addTrackPoint(next_p))
                            trackCell(row, column + 1, "left");
                    }
                }
            }
            else if (dir == 'right') {
                cell = contourModel.getCell_S(row, column - 1);
                next_p = cell && cell.x_isoPoints ? Sun.Util.Array.getItemByField(cell.x_isoPoints, 'value', t_value) : null;
                if (closed(p0, next_p))
                    return true;
                // 查找本点上一列的x方向是否有等值点
                if (addTrackPoint(next_p))
                    trackCell(row, column - 1, "bottom");
                else {
                    // 查找本点上一列的y方向是否有等值点
                    next_p = cell && cell.y_isoPoints ? Sun.Util.Array.getItemByField(cell.y_isoPoints, 'value', t_value) : null;
                    if (closed(p0, next_p))
                        return true;
                    if (addTrackPoint(next_p))
                        trackCell(row, column - 1, "right");
                    else {
                        // 若本点上一列的y方向无等值点，则查找本点下一行上一列的x方向是否有等值点
                        cell = contourModel.getCell_S(row + 1, column - 1);
                        next_p = cell && cell.x_isoPoints ? Sun.Util.Array.getItemByField(cell.x_isoPoints, 'value', t_value) : null;
                        if (closed(p0, next_p))
                            return true;
                        if (addTrackPoint(next_p))
                            trackCell(row + 1, column - 1, "top");
                    }
                }
            }
        }

        function closed(p1, p2) {
            return p1 && p2 && L.latLng(p1).equals(p2.latlng);
        }

        function addTrackPoint(p) {
            if (p && !p.tracked) {
                p.tracked = true;
                line.pointitems.push(p.latlng);
                // line.bounds.extend(p.latlng);
                return true;
            }
            else
                return false;
        }

    },

    _fixData: function (data) {
        for(i=0;i<data.length;i++){
            var points = data[i].pointitems;
            if(points.length>4){
                var fixPoints = [];
                for(j=0;j<points.length;j++){
                    if(j==0 || j==points.length-1){
                        fixPoints.push(points[j]);
                        // var n_marker=LW.nameMarker(L.latLng(points[j]),{iconOptions:{radius: 3,color: '#ff0',iconType: 'graph'}}).addTo(map);
                        // n_marker.options.icon.setData([],'');
                    }
                    else{
                        var latlng0 = L.latLng(points[j-1]);
                        var latlng1 = L.latLng(points[j]);
                        var latlng2 = L.latLng(points[j+1]);
                        var dis1 = latlng0.distanceTo(latlng1);
                        var dis2 = latlng1.distanceTo(latlng2);
                        if(dis1+dis2>5000){
                            fixPoints.push(points[j]);
                            // var n_marker=LW.nameMarker(latlng1,{iconOptions:{radius: 3,color: '#00f',iconType: 'graph'}}).addTo(map);
                            // n_marker.options.icon.setData([],'');
                        }
                    }
                }
                data[i].pointitems = fixPoints;
            }
        }
        return data;
    }

});

/**
 *
 * @module Layer.Plot.Contour
 */
/**
 * 等值线填色
 *
 * Features :
 *      1. 判断多边形的关系-排序-填色
 *
 * Update Note：
 *      + v1.3.0-dev ：修正图例中没有的填色为null，而非白色
 *      + v1.4.4 : 增加line上fixColor属性判断，用于编辑时忽略legendData,直接用给定的颜色
 *
 * @class LW.Tinter
 * @extends L.Class
 */
LW.Tinter = L.Class.extend({
    options: {
        editable: false
    },

    /**
     *
     * @param options
     */
    initialize: function (options) {
        L.setOptions(this, options);
    },

    /**
     * 获取等值面数据
     * @method getIsolineData
     * @param legendData;
     * @param isolineData {Array} 跟踪得到的等值线数据
     * @returns {Array}
     */
    getPlaneData: function (legendData,isolineData) {
        // 设置多边形关系判断
        this._setLineRelationShip(isolineData);

        // 修正子面值与父面值一致的值
        // for (var i = 0; i < isolineData.length; i++) {
        //     var line = isolineData[i];
        //     if (line.cid) {
        //         for (var j = 0; j < line.cid.length; j++) {
        //             var cline = isolineData[line.cid[j]];
        //             if(cline.linevalue == line.linevalue){
        //                 var idx = Sun.Util.Array.getItemIndexByField(legendData,'min',line.linevalue);
        //                 if(idx>0)
        //                     cline.linevalue = legendData[idx-1].min;
        //             }
        //         }
        //     }
        // }

        // 面数据
        var planeData = [];
        for (var i = 0; i < isolineData.length; i++) {
            var line = isolineData[i];
            var value ,color;
            if(line.fixColor){ // Tip:增加line上fixColor属性判断，用于编辑是忽略legendData,直接用给定的颜色
                value = line.linevalue;
                color = line.fixColor;
            }
            else {
                value = line.tinterValue = line.tinterValue || (line.linevalue + getTinterValue(line));
                color = Sun.Util.LegendData.getColorOfRangeLegend(legendData, value,'rgba(0,0,0,0)');
            }
            var plane = {id: i, planevalue: value, pointitems: [line.pointitems],planecolor:color};
            if (line.cid) {
                for (var j = 0; j < line.cid.length; j++) {
                    var cline = isolineData[line.cid[j]];
                    plane.pointitems.push(cline.pointitems);
                }
            }
            planeData.push(plane);

            if (this.options.editable) {//Tip:用于色斑图编辑洞关联
                if (!isNaN(line.pid)) {
                    var cids = isolineData[line.pid].cid;
                    var cindex = cids.indexOf(i) + 1;
                    plane.linkHoleId = line.pid + '_' + cindex;
                }
            }
        }
        return planeData;

        function getColor(legendData, v1, v2) {
            var val = v1 < v2 ? v1 + (v2 - v1) / 2 : v2 + (v1 - v2) / 2;
            return Sun.Util.LegendData.getColorOfRangeLegend(legendData, val,'rgba(0,0,0,0)');
        }

        function getTinterValue(line) {
            if(isValidPid(line) && isolineData[line.pid].linevalue == line.linevalue){
                var count=0;
                getPid(line);
                return count%2==0 ? 0.01 : -0.01;
            }
            else
                return (isValidPid(line) && isolineData[line.pid].linevalue > line.linevalue) ? -0.01 : 0.01;

            function getPid(line) {
                if(isValidPid(line) && isolineData[line.pid].linevalue == line.linevalue){
                    count++;
                    getPid(isolineData[line.pid]);
                }
            }

            function isValidPid(line) {
                return typeof line.pid != 'undefined' && !isNaN(line.pid) && line.pid !=-1;
            }
        }
    },

    _setLineRelationShip: function (data) {
        for (var i = 0; i < data.length; i++) {
            var line0 = data[i];
            var p0 = line0.pointitems[0];
            line0.cid = line0.cid || [];
            for (var j = i + 1; j < data.length; j++) {
                var line1 = data[j];
                var p1 = line1.pointitems[0];
                line0.id = i;
                line1.id = j;
                line1.cid = line1.cid || [];
                if (Sun.Util.Geometry.pointInPolygon(p0[0], p0[1], line1.pointitems)) {
                    // line0在line1里面
                    if (isNaN(line0.pid)) {
                        line0.pid = j;
                        line1.cid.push(i);
                    }
                    else {
                        // 如果line0已经有parent，则比较line1与line0原parent（line2）的关系
                        // 如果line1在line2中，line0的parent变成line1，line2删掉line0这个child，多一个line1这个child
                        var line2 = data[line0.pid];
                        if (Sun.Util.Geometry.pointInPolygon(p1[0], p1[1], line2.pointitems)) {
                            line2.cid.splice(line2.cid.indexOf(i), 1);
                            line0.pid = j;
                            line1.cid.push(i);
                        }
                    }
                }
                else if (Sun.Util.Geometry.pointInPolygon(p1[0], p1[1], line0.pointitems)) {
                    if (isNaN(line1.pid)) {
                        line1.pid = i;
                        line0.cid.push(j);
                    }
                    else {
                        line2 = data[line1.pid];
                        if (Sun.Util.Geometry.pointInPolygon(p0[0], p0[1], line2.pointitems)) {
                            line2.cid.splice(line2.cid.indexOf(j), 1);
                            line1.pid = i;
                            line0.cid.push(j);
                        }
                    }
                }
            }
        }
    }
});


LW.CanvasLayer = L.Layer.extend({
    options:{
        opacity: 0.8,
        renderer: LW.canvas()
    },

    getEvents: function () {
        return {
            _zoomend: this._zoomend,
            // resize: this._resize,
            movestart: this._movestart,
            moveend: this._update
        };
    },

    beforeAdd: function (map) {
        this._map = map;
        this._renderer = map.getRenderer(this);
    },

    onAdd: function () {
        this._renderer = this._map.getRenderer(this);
        this._update();
    },

    onRemove: function () {
        if (this._map.hasLayer(this._renderer))
            this._map.removeLayer(this._renderer);
    },

    _zoomend:function (e) {},

    _movestart:function(e){},

    _resize:function(e){},

    _update:function (e) {},

    clear: function () {
        if(this._renderer){
            var size = this.size = this._renderer._bounds.getSize();
            this._renderer._ctx.clearRect(0, 0, size.x, size.y);
        }
    },
    /**
     * 设置填色透明度
     * @method setOpacity
     * @param opacity
     */
    setOpacity:function (opacity) {
        this.options.opacity = opacity;
        this._update();
    },

    resetMask:function (maskGeoJson) {
        this.options.renderer.resetMask(maskGeoJson);
        this._update();
    }

});

/**
 * 等值线图层
 * Update Note：
 *      + v1.3.0-dev ：planeColor为null的，不予绘制
 */
LW.IsolineLayer = L.FeatureGroup.extend({
    options: {
        stroke: true,
        fill: true,
        color: '#A52829',
        weight: 1,
        hexColor: false,
        // fillColor: same as color by default
        fillOpacity: 1,
        pointerEvents: 'none',
        patternFill:false,
        geoInstance:LW.spline,
        nonBubblingEvents: ['click']
    },

    initialize: function (options) {
        this._layers = {};
        L.setOptions(this, options);
    },
    setData: function (data) {
        this.data = data;
        // this.clearLayers();//因主要用在色斑图，未用于数值预报，然后多个色斑图展示不允许在此清空，遂先注释
        var options = this.options;
        for (var i = 0; i < data.length; i++) {
            var o = data[i];
            if(o.planecolor){
                // var options = Sun.Util.Data.clone(this.options);
                // options.closed = parseInt(o.linetype) != 0;
                options.fillColor = o.planecolor;
                var spline = options.geoInstance(o.pointitems, options).addTo(this);
                spline.value = o.planevalue;
                spline.id = o.id;
            }
        }
    },

    getLayerByID: function (id) {
        for (var s in this._layers) {
            var m = this._layers[s];
            if (m.id == id)
                return m;
        }
    },
    everyMarker: function (fun) {
        for (var s in this._layers) {
            var m = this._layers[s];
            m.options.color = this.options.color;
            m.options.pointerEvents = this.options.pointerEvents;
            fun(m);
        }
    },
    setLineColor: function (color) {
        this.options.color = color;
        this.eachLayer(function (layer) {
            layer.setStyle({'color':color})
        }, this);
    },
    setFillVisible: function (visible) {
        this.options.fill = visible;
        this.eachLayer(function (layer) {
            layer.setStyle({'fill':visible})
        }, this);
    },
    setLineVisible: function (visible) {
        this.options.stroke = visible;
        this.eachLayer(function (layer) {
            layer.setStyle({'stroke':visible})
        }, this);
    },
    _updateStyle: function (geo) {
        if (geo instanceof LW.Spline) {
            geo.options.color = this.options.color;
            geo.options.fill = this.options.fill;
            geo.options.stroke = this.options.stroke;
            geo._updateStyle();
        }
    }
    // setPointerEvents:function(value){
    //     this.options.pointerEvents = value;
    //     this.eachLayer(this._updateStyle);
    // }
});

LW.isolineLayer = function (options) {
    return new LW.IsolineLayer(options);
};

/**
 * 等值面图层
 */

LW.IsosurfaceLayer = L.FeatureGroup.extend({
    options: {
        stroke: true,
        fill: true,
        color: '#A52829',
        weight: 1,
        hexColor: false,
        // fillColor: same as color by default
        fillOpacity: 1
    },

    initialize: function (options) {
        this._layers = {};
        L.setOptions(this, options);
    },
    setData: function (data) {
        if (this._map) {
            this.clearLayers();
            for (var i = 0; i < data.length; i++) {
                var o = data[i];
                var options = Sun.Util.Data.clone(this.options);
                if (Sun.Util.Common.isValid(o.planecolor))
                    options.fillColor = options.hexColor ? o.planecolor : Sun.Util.Color.toHexColor(o.planecolor);
                else
                    options.fill = false;
                options.interactive = false;
                var geo = LW.geometryUnion(o.subplaneitems, options).addTo(this);
                geo.value = o.planevalue;
                geo.id = i;
            }
        }
    },
    getLayerByID: function (id) {
        for (var s in this._layers) {
            var m = this._layers[s];
            if (m.id == id)
                return m;
        }
    },
    everyMarker: function (fun) {
        for (var s in this._layers) {
            var m = this._layers[s];
            m.options.fill = this.options.fill;
            m.options.stroke = this.options.stroke;
            fun(m);
        }
    },
    setFillVisible: function (visible) {
        this.options.fill = visible;
        this.everyMarker(this._updateStyle);
    },
    setLineVisible: function (visible) {
        this.options.stroke = visible;
        this.everyMarker(this._updateStyle);
    },
    _updateStyle: function (geo) {
        if (geo instanceof LW.GeometryUnion)
            geo._updateStyle();
    }
});

LW.isosurfaceLayer = function (options) {
    return new LW.IsosurfaceLayer(options);
};

/**
 * 等值线标注图层
 */
LW.IsolabelLayer = LW.CanvasLayer.extend({
    options: {
        color: '#A52829',
        font: '12px Microsoft Yahei',
        labelRotate:false,
        bold:true,
        renderer: LW.canvas({pane:'gridPane',interactive:false})
    },

    initialize:function(options){
        L.setOptions(this,options);
    },

    setData: function (data) {
        this.data = data;
        this._update();
        return this;
    },

    resetMask: function (mask) {
        this.options.maskGeoJson = mask;
        if (mask) {
            var maskBounds = this.maskBounds = L.latLngBounds([]);
            for (var key in mask._layers) {
                var layer = mask._layers[key];
                layer._latlngs.forEach(function (item) {
                    maskBounds.extend(L.latLngBounds(item));
                })
            }
        }
        this._update();
    },

    _update: function () {
        this.clear();
        if (this.data) {
            var options = this.options;
            var ctx = this._renderer._ctx;
            ctx.font = options.font;
            ctx.textAlign = 'center';
            ctx.fillStyle = options.color;
            ctx.lineWidth=2;
            ctx.strokeStyle = '#fff';
            for (var i = 0; i < this.data.length; i++) {
                var o = this.data[i];
                var value = o.linevalue;
                if (!isNaN(value)){
                    if(markerShow(value,this.filterOptions))
                        this._setLineLabel(o.pointitems, Sun.Util.Math.toRoundFixed(value, 1));
                }
            }
        }

        function markerShow(value,f_options) {
            if (f_options){
                var min = f_options.min,max=f_options.max;
                return ((value > min && value < max) || (isNaN(min) && value < max) || (isNaN(max) && value > min) ||
                    (f_options.isEqualMin && value === max) || (f_options.isEqualMax && value === min))
            }
            return true;
        }
    },

    // _lableInMask: function (latlng) {
    //     var mask = this.options.maskGeoJson;
    //     var maskBounds = this.maskBounds;
    //     var xy = this._map.latLngToContainerPoint(latlng);
    //     var size = this._map.getSize();
    //     if(xy.x>0 && xy.y>0 && xy.x<size.x && xy.y<size.y){
    //         if (mask) {
    //             for (var key in mask._layers) {
    //                 var layer = mask._layers[key];
    //                 for(var i = 0; i < layer._latlngs.length;i++){
    //                     var inMask = Sun.Util.Geometry.latlngInPolygon(latlng, layer._latlngs[i],maskBounds);
    //                     if(inMask)
    //                         return true;
    //                 }
    //             }
    //             return false;
    //         }
    //         else
    //             return true;
    //     }
    //     else
    //         return false;
    //
    // },
    _lableInMask: function (latlng,xy) {
        var mask = this.options.maskGeoJson;
        var maskBounds = this.maskBounds;
        var size = this._map.getSize();
        if(xy.x>0 && xy.y>0 && xy.x<size.x && xy.y<size.y){
            if (mask) {
                var p = this._map.latLngToLayerPoint(latlng);
                for (var key in mask._layers) {
                    var layer = mask._layers[key];
                    var parts = layer._parts;
                    for(var i = 0; i < parts.length;i++){
                        if(parts[i].length>2){
                            var points = parts[i].map(function (item) {
                                return [item.x,item.y];
                            });
                            var inMask = Sun.Util.Geometry.pointInPolygon(p.x,p.y, points);
                            if(inMask)
                                return true;
                        }
                    }
                }
                return false;
            }
            else
                return true;
        }
        else
            return false;

    },

    _setLineLabel: function (locations, value) {
        if (this._map) {
            // TODO:此处应将截取点的代码提出，然后将点转化坐标的方法放入适配器中，以后再优化(剖面中copy此段代码)
            var map = this._map;
            var firstLocation = locations[0];
            var lastLocation = locations[0];
            var p0 = map.latLngToContainerPoint(firstLocation);
            var labeled = false;
            var flag = false;
            // var rotate = this.options.labelRotate;
            var ctx = this._renderer._ctx;
            for (var i = 0; i < locations.length - 1; i++) {
                var loc1 = locations[i];
                var loc2 = locations[i + 1];
                var loc = L.latLng((loc1[0] + loc2[0]) / 2, (loc1[1] + loc2[1]) / 2);
                var p1 = map.latLngToContainerPoint(lastLocation);
                var p2 = map.latLngToContainerPoint(loc);
                // if (p1.distanceTo(p2) >= 300) {
                if (distance(p1,p2) >= Math.pow(300,2)) {
                    if (this._lableInMask(loc,p2)) {
                        // var p3 = map.latLngToContainerPoint(loc2);
                        // var rotation = rotate?Math.atan2(p3.y - p1.y, p3.x - p1.x) * 180 / Math.PI:null;
                        drawMarker(value,p2/*,rotation*/);
                    }
                    lastLocation = loc;
                    labeled = true;
                }
                else if (!labeled && distance(p0,p2) >= Math.pow(20,2))
                    flag = true;
            }
            if (!labeled && flag) {
                i = parseInt(locations.length / 2);
                loc1 = locations[i];
                i = i + 1 >= locations.length ? 0 : i + 1;
                loc2 = locations[i];
                loc = L.latLng((loc1[0] + loc2[0]) / 2, (loc1[1] + loc2[1]) / 2);

                p1 = map.latLngToContainerPoint(loc);
                if (this._lableInMask(loc,p1)) {
                    // p3 = map.latLngToContainerPoint(loc2);
                    // rotation = rotate?Math.atan2(p3.y - p1.y, p3.x - p1.x) * 180 / Math.PI:null;
                    drawMarker(value,p1/*,rotation*/);
                }
            }
        }
        function distance(p1,p2) {
            return Math.pow(p1.x-p2.x,2)+Math.pow(p1.y-p2.y,2)
        }

        function drawMarker(value, p, rotate) {
            // ctx.translate(p.x, p.y);
            // ctx.rotate(rotate);
            // ctx.translate(-p.x, -p.y);

            ctx.strokeText(value, p.x, p.y);
            ctx.fillText(value, p.x, p.y);

            // ctx.setTransform(Sun.Common.dpr, 0, 0, Sun.Common.dpr, 0, 0);
        }
    },

    showAllMarker: function () {
        this.filterOptions = null;
        this._update();
    },

    filterMarker: function (minValue, isEqualMin, maxValue, isEqualMax) {
        this.filterOptions = {min: minValue, isEqualMin: isEqualMin, max: maxValue, isEqualMax: isEqualMax};
        this._update();
    }
});

LW.isolabelLayer = function (options) {
    return new LW.IsolabelLayer(options);
};
/**
 * 数值预报、色斑图图层；剖面等
 * @module Layer.Plot
 */

/**
 * 数值预报图层
 *
 * Features :
 *      1. 包含等值线、等值面、标注、格点值等
 *      2. 主要是非风类数值预报所用图层及色斑图图层
 *      3. 需引用d3.js
 *
 * Update Note：
 *      + v1.0.0 ：Created
 *      + v1.0.3 ：支持用数据的边界作为遮罩
 *      + v1.0.4 ：增加图层未添加在地图上仍可设置数据的功能
 *      + v1.0.4-dev ：增加过滤功能
 *      + v1.1.0-dev ：增加色斑图不显示时，格点值根据色谱描边的功能
 *      + v1.4.0 ：修正色谱中没有的色块，不填色，而非填白色，主要是修正降水色谱不传0，希望得到透明的效果，需基于sun1.0.13
 *      + v1.4.0-dev : 色斑图增加canvas渲染器，格点图层也增加遮罩，标注图层改为canvas渲染
 *      + v1.4.8/v1.5.1 : 格点值图层改为基于gridModel的LW.GridLayer，相应的属性也变成LW.GridLayer中的属性
 *      + v1.5.1 ：增加网格值过滤的功能
 *
 *
 * @class LW.NwpLayer
 * @extends L.LayerGroup
 * @demo demo/plot/contour/nwp.html  {非风类数值预报}
 */

LW.NwpLayer = L.LayerGroup.extend({
    options: {

        /**
         * 是否绘制等值线
         * @property stroke
         * @type {boolean}
         * @default true
         */
        stroke: true,

        /**
         * 等值线颜色
         * @property color
         * @type {string}
         * @default '#A52829'
         */
        color: '#A52829',

        /**
         * 等值线粗细
         * @property weight
         * @type {int}
         * @default 1
         */
        weight: 1,

        /**
         * 等值线透明度
         * @property opacity
         * @type {number}
         * @default 1
         */
        opacity: 1,

        /**
         * 是否填色
         * @property fill
         * @type {boolean}
         * @default true
         */
        fill: true,

        /**
         * 填色透明度
         * @property fillOpacity
         * @type {number}
         * @default 0.8
         */
        fillOpacity: 0.8,

        /**
         * 是否标注
         * @property label
         * @type {boolean}
         * @default true
         */
        label: true,

        /**
         * 标注颜色
         * @property labelColor
         * @type {string}
         * @default '#A52829'
         */
        labelColor: '#A52829',

        /**
         * 标注字体
         * @property font
         * @type {string}
         * @default '12px'
         */
        font: '12px Microsoft Yahei',

        /**
         * 标注是否旋转
         * @property labelRotate
         * @type {boolean}
         * @default false
         */
        labelRotate:false,

        /**
         * 是否展示格点值
         * @property grid
         * @type {boolean}
         * @default true
         */
        grid: true,

        /**
         * 网格图层属性
         * @property gridOptions
         * @type {object}
         * @param {LW.GridLayer}  详见LW.GridLayer的Options
         * @default
         */
        gridOptions: {
            elements:['value'],
            elementsVisible:{value:false},
            pane:'gridPane'
        },

        /**
         * 填充颜色是否为十六进制颜色
         *
         * 接口取数得到数据颜色为十进制
         *
         * @property hexColor
         * @type {boolean}
         * @default false
         */
        hexColor: false,

        /**
         * 渲染器
         *
         * 如果不使用默认需要在new时传入渲染器
         *
         * @property renderer
         * @type {L.Renderer}
         * @default L.svg()
         */
        renderer: LW.clipPathSvg(),

        /**
         * 是否用数据的边界作为遮罩，用于隐藏图形最外一圈线条
         * 仅支持麦卡托投影
         * @property boundMask
         * @type {boolean}
         * @default true
         */
        boundMask: true,

        isolineInstance: LW.isosurfaceLayer,
        geoInstance: LW.spline,
        /**
         * 在canvas为渲染器时，曲线算法比较耗性能，在某些等级下只展示折线来优化性能。
         * 尤其是数值预报这种网格密集型数据。站点色斑图可以已情况配置较低的数值
         * @property curveZoom
         * @type {int}
         * @default 7
         */
        curveZoom:7
    },

    isolineLayer: null,
    isolabelLayer: null,

    initialize: function (options) {
        this._layers = {};
        L.setOptions(this, options);
        var _options = this.options;
        var maskGeoJson = _options.renderer.options.maskGeoJson;
        // 等值面图层
        this.isolineLayer = _options.isolineInstance({
            fillOpacity: _options.fillOpacity, color: _options.color, hexColor: _options.hexColor,
            fill: _options.fill, stroke: _options.stroke, weight: _options.weight,curveZoom:options.curveZoom,
            renderer: _options.renderer, interactive:_options.interactive,geoInstance:_options.geoInstance,
            editable: _options.editable, patternFill:_options.patternFill
        });
        this.addLayer(this.isolineLayer);

        // 标注图层
        if (_options.label) {
            this.isolabelLayer = LW.isolabelLayer({color: _options.labelColor, font: _options.font,
                labelRotate:_options.labelRotate});
            this.addLayer(this.isolabelLayer);
            if(maskGeoJson)
                this.isolabelLayer.resetMask(maskGeoJson);
        }

        // 网格图层
        if (_options.grid) {
            var gridOptions = this.options.gridOptions;
            gridOptions.renderer = LW.canvas({grid:true,maskGeoJson:maskGeoJson,pane:gridOptions.pane||'gridPane',interactive:false});
            var gridModel = new LW.GridModel({dataType: 'json'});
            this.gridLayer = LW.gridLayer(gridModel,gridOptions);
            this.addLayer(this.gridLayer);
        }

    },

    onAdd: function (map) {
        for (var i in this._layers) {
            map.addLayer(this._layers[i]);
        }
        if (this.data){
            this.setData(this.data);
        }
    },


    /**
     * 设置遮罩
     * @method setMask
     * @param maskGeoJson {L.GeoJSON} 遮罩geojson
     * @param boundMask
     */
    setMask: function (maskGeoJson,boundMask) {
        this.options.renderer.resetMask(maskGeoJson);
        if(this.isolabelLayer)
            this.isolabelLayer.resetMask(maskGeoJson);
        if(this.gridLayer)
            this.gridLayer.resetMask(boundMask ? false : maskGeoJson);
    },

    /**
     * 设置图层数据，并绘制
     * @method setData
     * @param data {Array}
     */
    setData: function (data) {
        this.data = data;
        this.clear();
        if (this._map && data) {
            // if (this.options.boundMask)
            //     this._setBoundMask();
            this.isolineLayer.setData(data.planeitems);
            if (this.options.label)
                this.isolabelLayer.setData(data.lineitems);
            if (this.options.grid)
                this.gridLayer.setData(data);
            if (!this.options.stroke && this.options.label)
                this._setLabelVisible(false);
        }
    },

    setBoundMask:function () {
        var data = this.data;
        if(data && this.options.boundMask){
            var maskdata = {
                "type": "FeatureCollection",
                "features": [{
                    "type": "Feature", "id": "1", "properties": {"name": "bound"}, "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[data.startlon + data.nlon, data.startlat + data.nlat],
                            [data.startlon + data.nlon, data.endlat - data.nlat],
                            [data.endlon - data.nlon, data.endlat - data.nlat],
                            [data.endlon - data.nlon, data.startlat + data.nlat]]]
                    }
                }]
            };
            var mask = LW.maskGeoJson(maskdata).addTo(this);
            this.setMask(mask,true);
        }
    },

    /**
     * 清除图层
     * @method clear
     */
    clear: function () {
        this.isolineLayer.clearLayers();
        if (this.options.label){
            this.isolabelLayer.setData(null);
            this.isolabelLayer.clear();
        }
        if (this.options.grid) {
            this.gridLayer.setData(null);
            this.gridLayer.clear();
        }
    },

    /**
     * 设置格点要素显隐
     * @method setGridDistanceScale
     * @param element {string}
     * @param visible {boolean}
     */
    setGridElementVisible: function (element,visible) {
        this.gridLayer.setGridElementVisible(element,visible);
    },

    /**
     * 设置填色显隐
     * @method setFillVisible
     * @param value {boolean} 显隐值
     */
    setFillVisible: function (value) {
        this.isolineLayer.setFillVisible(value);
    },

    /**
     * 设置等值线显隐
     * @method setLineVisible
     * @param value {boolean} 显隐值
     */
    setLineVisible: function (value) {
        this.options.stroke = value;
        //等值线
        this.isolineLayer.setLineVisible(value);
        //标注
        if (this.options.label)
            this._setLabelVisible(value);
    },

    _setLabelVisible: function (value) {
        if (value && !this.hasLayer(this.isolabelLayer)) {
            this.addLayer(this.isolabelLayer);
            this.isolabelLayer._update();
        }
        else if (!value && this.hasLayer(this.isolabelLayer))
            this.removeLayer(this.isolabelLayer);
    },

    setStyle : function (style) {
        var _setStyle=function (m) {
            m.setStyle(style)
        };
        L.setOptions(this.isolineLayer, style);
        this.isolineLayer.eachLayer(_setStyle, this);
    },

    /**
     * 显示所有， 用于过滤后的恢复
     * @method showAll
     */
    showAll: function () {
        var _showAllGeo = function (m) {
            L.setOptions(m, {fillOpacity: this.options.fillOpacity, opacity: 1});
            m._updateStyle();
        };
        this.isolineLayer.eachLayer(_showAllGeo, this);
        if(this.isolabelLayer)
            this.isolabelLayer.showAllMarker();
        if(this.gridLayer)
            this.gridLayer.showAllRange();
    },
    /**
     * 过滤 注：若filter的value为无有效值则直接过滤
     * @method filter
     * @param minValue {number} 不填或NaN时仅过滤出比maxValue小的值
     * @param isEqualMin {boolean} 是否将等于minValue的值过滤
     * @param maxValue {number} 不填或NaN时仅过滤出比minValue大的值
     * @param isEqualMax {boolean} 是否将等于maxValue的值过滤
     */
    filter: function (minValue, isEqualMin, maxValue, isEqualMax) {
        var setGeoVisible = function (m) {
            if (m instanceof L.Polygon) {
                var value = m.value,
                    options,
                    showOptions = {fillOpacity: this.options.fillOpacity, opacity: 1},
                    hideOptions = {fillOpacity: 0, opacity: 0};
                if (isNaN(minValue) && isNaN(maxValue))
                    options = showOptions;
                else if (isNaN(minValue)) {
                    options = value <= maxValue ? showOptions : hideOptions;
                    if (isEqualMax && value == maxValue)
                        options = hideOptions;
                }
                else if (isNaN(maxValue)) {
                    options = value >= minValue ? showOptions : hideOptions;
                    if (isEqualMin && value == minValue)
                        options = hideOptions;
                }
                else {
                    options = value <= maxValue && value >= minValue ? showOptions : hideOptions;
                    if (isEqualMin && value == minValue)
                        options = hideOptions;
                    if (isEqualMax && value == maxValue)
                        options = hideOptions;
                }
                L.setOptions(m, options);
                m._updateStyle();
            }
        };
        this.isolineLayer.eachLayer(setGeoVisible, this);
        if(this.isolabelLayer)
            this.isolabelLayer.filterMarker(minValue, isEqualMin, maxValue, isEqualMax);
        if(this.gridLayer)
            this.gridLayer.setDataRange({min:minValue,max:maxValue});
    }
});

/**
 * @class LW.NwpLayer
 * @constructor
 * @param options {object} 外部属性，可重设Properties
 * @returns {LW.NwpLayer}
 */
LW.nwpLayer = function (options) {
    return new LW.NwpLayer(options);
};


/**
 *
 * @module Layer.Plot
 */
/**
 * 色斑图图层
 *
 * Features ：
 *      1. 原理：由站点通过插值、跟踪、填色然后绘制生成
 *      2. 渲染器为svg时需引用d3.js
 *      3. options.bounds是网格的边界，一般用遮罩的边界，要保证数据与边界是几乎对应的，否则插值没有数据依据，导致误差较大
 *      4. options.rows,options.columns是网格的行列，和省、市边界的形状关系很大，竖向型配置行多列少，横向型配置列多行少，近似正方形配置行列一样多。
 *      5. 色板图图例数据只能由小到大，图例min/max必须收尾相接，不能跳空
 *      Tip：由于色斑图算法的特性，是描述所有站点的趋势，而不是针对每个点独立的描述，所以可能出现等值线无法包含某些点情况，加大网格密度的会有所好转，但不能避免所有的情况
 *
 * Update Note ：
 *      + v1.0.0 ：Created
 *      + v1.0.1 ：色斑图插值、跟踪、填色前端完成
 *      + v1.0.2 ：增加色斑图可动态配置遮罩功能
 *      + v1.0.4 ：增加可从网格数据生成色斑图的功能
 *      + v1.1.0-dev ：增加克里金和径向基函数插值方法，及其可选配置
 *      + v1.3.0-dev : 通过简化等值线的点让等值线展示的更平滑，和删除点数小于某值的等值线的功能
 *      + v1.4.0-dev : 色斑图增加canvas渲染器，格点图层也增加遮罩，标注图层改为canvas渲染,如果没有编辑，推荐使用canvas渲染器
 *      + v1.4.4 : 增加根据模式填充图例进行填色的功能，需基于sun@1.0.16
 *
 * Bug Feedback ：(请将以下内容整理发送王海伦测试)
 *      1. 错误的色斑图截图
 *      2. 简单的错误描述
 *      3. 数据保存成文件
 *      4. 遮罩文件
 *      5. 图例数据
 *      6. 色斑图的配置截图，包含bounds,rows,columns等
 *
 * @class LW.ContourLayer
 * @extends LW.NwpLayer
 * @demo demo/plot/contour/contour.html  {色斑图}
 * @demo demo/plot/contour/contour_pattenfill.html  {色斑图--模式填充}
 * @demo demo/plot/contour/contour_visib.html  {色斑图--能见度}
 * @demo demo/plot/contour/contour_mask_change.html  {色斑图--改变遮罩}
 * @demo demo/plot/contour/contour_grid.html  {色斑图--格点数据}
 */
LW.ContourLayer = LW.NwpLayer.extend({
    options: {
        hexColor: true,
        grid: false,
        /**
         * 网格列数(越大则性能越差，但插值会更准确)
         * @property columns
         * @type {int}
         * @default 50
         */
        columns: 50,
        /**
         * 网格行数(越大则性能越差，但插值会更准确)
         * @property rows
         * @type {int}
         * @default 50
         */
        rows: 50,

        /**
         * 参与插值的离散点最少数量
         * @property iPointMinNum
         * @type {int}
         * @default 3
         */
        iPointMinNum: 3,
        /**
         * 插值指数，离散点的比重的指数
         * @property pow
         * @type {int}
         * @default 5
         */
        pow: 5,

        /**
         * 查找的最大行数
         * @property seekMaxRow
         * @type {int}
         * @default 50
         */
        seekMaxRow:50,
        /**
         * 查找的最列数
         * @property seekMaxColumn
         * @type {int}
         * @default 50
         */
        seekMaxColumn:50,

        /**
         * 插值的方法
         * 选项 :
         *      1. idw -- 反距离加权插值
         *      2. kriging -- 克里金插值，不适合大数据量的插值，会比较慢且准度不够
         *      3. rbf -- 径向基函数插值
         * @property method
         * @type {string}
         * @default 'idw'
         */
        method:'idw',

        /**
         * 等值线粗细
         * @property weight
         * @type {int}
         * @default 1
         */
        weight: 1,

        /**
         * 插值边界
         * @property bounds
         * @type {L.latLngBounds}
         * @default null
         */
        bounds: null,

        /**
         * 离散点值缩放比（主要用于能见度，其缩放比为0.001）
         * @property valueScale
         * @type {number}
         * @default 1
         */
        valueScale: 1,

        /**
         * 是否用数据的边界作为遮罩
         * @property boundMask
         * @type {Boolean}
         * @default false
         */
        boundMask: false,

        latField:'STATIONLAT',

        lonField:'STATIONLON',

        isolineInstance: LW.isolineLayer
    },

    initialize: function (options) {
        LW.NwpLayer.prototype.initialize.call(this, options);
        options = this.options;
        this.contourModel = new LW.ContourModel({latField:options.latField,lonField:options.lonField,
            method:options.method,iPointMinNum:options.iPointMinNum,pow:options.pow,
            seekMaxRow:options.seekMaxRow,seekMaxColumn:options.seekMaxColumn,editable: this.options.editable});
        this.setBounds(options.bounds);
    },

    /**
     * 设置插值边界
     * @method setBounds
     * @param bounds {L.latLngBounds} 插值的边界
     */
    setBounds: function (bounds) {
        if(bounds){
            this.options.bounds = bounds;
            this.contourModel.setGridBounds(bounds,this.options.rows,this.options.columns);
        }
    },

    /**
     * 重置网格属性
     * @param rows {int} 网格密度-行
     * @param columns {int} 网格密度-列
     * @param options {object} 其他网格属性
     */
    resetGridOptions:function (rows,columns,options) {
        var cModel = this.contourModel;
        if(rows) this.options.rows = cModel.rows = parseInt(rows);
        if(columns) this.options.columns = cModel.columns = parseInt(columns);
        L.setOptions(this.contourModel,options);
        this._resetContour();
    },

    _resetContour:function () {
        this.clear();
        this.source = this.contourModel.getContourDataOfZdz();
        this.setData(this.source);
    },

    /**
     * 显示色斑图
     * @method showContour
     * @param zdzData {Array|rbush} 自动站数据（离散数据）tip:有效值数量需大于等于3个
     * @param valueField {string} 值字段名
     * @param legendData {Array} 图例数据
     */
    showContour: function (zdzData, valueField, legendData) {
        this.clear();
        this.source = this.contourModel.getContourDataOfZdz(zdzData, valueField, legendData);
        this.setData(this.source);

    },

    /**
     * 由网格数据生成色斑图
     * @method showContourByGridData
     * @param source {Array} 网格数据
     * @param legendData {Array} 图例数据
     */
    showContourByGridData: function (source, legendData) {
        if(source){
            this.source = this.contourModel.getContourDataOfGrid(source,legendData);
            // 设置数据绘制
            this.setData(source);
        }
    },

    /**
     * 由nc网格数据生成色斑图
     * @method showContourByNcGrid
     * @param source {ArrayBuffer} nc数据
     * @param legendData
     * @param isWind Tip:Sun@1.0.16 changeGridNcToJson方法删除了isWind
     */
    showContourByNcGrid:function (source,legendData,isWind) {
        var data = Sun.Util.Data.changeGridNcToJson(new Uint8Array(source),'speed');
        this.showContourByGridData(data,legendData);
    },

    showContourByLineData:function (data,legendData) {
        var tinter = new LW.Tinter();
        var cLegend = this.contourModel ? this.contourModel.legendData : undefined;
        legendData = legendData || cLegend || this.legendData;
        if(legendData) this.legendData = legendData;
        data.planeitems = tinter.getPlaneData(legendData,data.lineitems);
        this.source = data;
        this.setData(data);
    },

    /**
     * 通过简化等值线的点让等值线展示的更平滑，和删除点数小于某值的等值线
     * 需要引用turf.js
     * @method simplifiedLines
     * @param x_smooth {number} 平滑系数，推荐使用0-1之间数值,传0值则不平滑,
     *                          由于是采用简化等值线的点来实现平滑，所以有可能出现外圈太过平滑和里面交叉的情况，此时建议使用更小值或者传0不平滑
     * @param x_deleteRinglet {int} 删除小圈系数，删除点数少于指定数值的小圈,传0值则不删除
     * @param withoutBoundary {boolean} 是否不含边界，因为边界的概化可能导致边界处形状的不准确。
     */
    simplifiedLines:function (x_smooth,x_deleteRinglet,withoutBoundary) {
        var data = Sun.Util.Data.deepClone(this.source);
        if(data && data.lineitems){
            var lines = x_deleteRinglet>0 ? [] : data.lineitems;
            if(x_deleteRinglet>0) {
                for (var i = 0; i < data.lineitems.length; i++) {
                    var item = data.lineitems[i];
                    if (item.pointitems.length > x_deleteRinglet) {
                        item.pid = NaN;
                        item.cid = [];
                        lines.push(item);
                    }
                }
                data.lineitems = lines;
            }
            if(x_smooth>0){
                if(withoutBoundary){
                    var bounds = turf.polygon([[[data.startlon, data.startlat],[data.startlon, data.endlat],
                        [data.endlon, data.endlat],[data.endlon, data.startlat],[data.startlon, data.startlat]]]);
                }
                for(var j=0;j<lines.length;j++){
                    if(lines[j].pointitems.length>4){
                        var _line = lines[j].pointitems.map(function (item) {
                            return [item[1],item[0]];
                        });
                        _line.push(_line[0]);
                        var poly = turf.polygon([_line]);
                        var simplified;
                        if(withoutBoundary){
                            if(turf.booleanContains(bounds, poly))//多边形再边界里
                                simplified = turf.simplify(poly, x_smooth/100, false);
                            else/* if (turf.booleanOverlap(poly, bounds))*/
                                continue;
                        }
                        else
                            simplified = turf.simplify(poly, x_smooth/100, false);
                        var coordinates = simplified.geometry.coordinates[0];
                        lines[j].pointitems = coordinates.map(function (item) {
                            return [item[1],item[0]];
                        })
                    }
                }
            }
            // 填色
            if(x_smooth>0 || x_deleteRinglet>0)
                data.planeitems = this.contourModel.getPlaneData(lines);
            this.setData(data);
        }
    },

    /**
     * 计算色斑图面积（单位：平方米）
     * [Deprecated]
     * @method getArea
     * @param legendData
     * @param geojson
     * @param data
     * @param outValue
     * @returns {*}
     */
    getArea:function(legendData,geojson,data,outValue){
        legendData = legendData || this.contourModel.legendData;
        geojson = geojson || this.options.renderer.options.maskGeoJson.data;
        data = data || Sun.Util.Data.deepClone(this.source);
        outValue = outValue || -1;
        // 重置图例面积
        legendData.forEach(function (item) {
            item.area = 0;
        });

        // 根据区域格点标记区域外的网格值为最小值
        if(!this.regionGrid)
            this.regionGrid = Sun.Util.Grid.getRegionGrid(this.contourModel,geojson);

        var contourModel = this.contourModel;
        var minValue = this.contourModel.minValue;
        for(var i=0;i<data.data.length;i++){
            data.data[i] = this.regionGrid[i]>0 ? data.data[i] : outValue;
        }
        contourModel.setGridByData(data);

        // 跟踪
        data.lineitems = contourModel.getIsolineData();
        // 填色
        data.planeitems = contourModel.getPlaneData(data.lineitems);
        this.setData(data);
        // 还原contourModel的网格
        contourModel.setGridByData(this.source);

        // 面积计算
        culArea();
        // 去除辅助计算的圈的面积
        legendData.forEach(function (item) {
            if(item.max<minValue)
                item.area = 0;
        });
        return legendData;

        function culArea() {
            data.lineitems.forEach(function (item) {
                var coords = item.pointitems.map(function (c) {
                    return [c[1],c[0]];
                });
                coords.push(coords[0]);
                var poly = turf.polygon([coords]);
                item._area = turf.area(poly);
            });
            data.lineitems.forEach(function (item) {
                var subArea = 0;
                if (item.cid) {
                    item.cid.forEach(function (id) {
                        subArea += data.lineitems[id]._area;
                    })
                }
                item.area = item._area-subArea;

                var idx = Sun.Util.LegendData.getColorIndex(legendData,item.tinterValue);
                if(idx !== -1){
                    var legendItem = legendData[idx];
                    legendItem.area = legendItem.area || 0;
                    legendItem.area += item.area;
                }
            });
        }
    }

});

/**
 * @class LW.ContourLayer
 * @constructor
 * @param options {object} 外部属性，可重设Properties
 * @returns {LW.ContourLayer}
 */
LW.contourLayer = function (options) {
    return new LW.ContourLayer(options);
};

/**
 * 遮罩GeoJson
 * @param data
 */
LW.maskGeoJson = function (data,isCanvas) {
    var options = {style: {weight: 0, color: '#000', opacity: 0, fillColor: "#000", fillOpacity: 0}};
    if(isCanvas)
        options.renderer = L.canvas({type:'mask'});
    var geo = L.geoJson(data, options);
    geo.data = data;
    return geo;
};

L.Layer.include({
    _layerAdd: function (e) {
        var map = e.target;

        // check in case layer gets added and then removed before the map is ready
        if (!map.hasLayer(this)) { return; }

        this._map = map;
        this._zoomAnimated = map._zoomAnimated;

        if (this.getEvents) {
            var events = this.getEvents();
            map.on(events, this);
            this.once('remove', function () {
                map.off(events, this);
            }, this);
        }

        this.onAdd(map);

        if (this.getAttribution && this._map.attributionControl) {
            this._map.attributionControl.addAttribution(this.getAttribution());
        }

        // Tip: 遮罩的特殊处理:事件前置,用于解决遮罩添加于被遮罩图层之后，事件响应滞后导致的遮罩位置异常的问题
        if(this.options.renderer && this.options.renderer.options.type == 'mask'){
            var _events = map._events.moveend;
            var e = _events[_events.length-1];
            if(e.ctx && e.ctx.options.type=='mask')
                _events.unshift(_events.pop());
        }

        this.fire('add');
        map.fire('layeradd', {layer: this});
    }
});

/**
 * 双线性插值的渐变网格图层
 *
 * Features :
 *      1. 组合LW.GradientLayer和LW.GridLayer
 *      2. 支持单个网格或多个嵌套网格
 *      3. 根据色谱渐变展示
 *
 * Update Note：
 *      + v1.4.7 ：Created
 *      + v1.5.1 ：增加过滤功能
 *      + v1.5.2 ：增加基于像素的间隔可配置的功能，主要用于基于canvas 2d的风流场的性能优化
 *
 * @class LW.GradientGridLayer
 * @extends L.LayerGroup
 * @demo demo/plot/contour/gradientLayer.html {渐变图层}
 */

LW.GradientGridLayer = L.LayerGroup.extend({
    options: {

        legendData:[],

        maskGeoJson:null,

        /**
         * 网格图层属性
         * @property gridOptions
         * @type {object}
         * @default
         */
        gridOptions: {
            elements:['value'],
            elementsVisible:{value:false},
            gridPosition:'leftbottom',
            pane:'gridPane'
        },
        /**
         * 填充图层属性
         * @property fillOptions
         * @type {object}
         * @default
         */
        fillOptions:{
            pane:'overlayPane'
        }
    },

    initialize: function (gridModel,options) {
        this._layers = {};
        L.setOptions(this, options);

        var fillOptions = this.options.fillOptions;
        fillOptions.renderer = LW.canvas({maskGeoJson:this.options.maskGeoJson,pane:fillOptions.pane||'overlayPane',interactive:false});
        this.fillLayer = LW.gradientLayer(gridModel,fillOptions);
        this.addLayer(this.fillLayer);

        var gridOptions = this.options.gridOptions;
        gridOptions.renderer = LW.canvas({maskGeoJson:this.options.maskGeoJson,pane:gridOptions.pane||'gridPane',interactive:false});
        this.gridLayer = LW.gridLayer(gridModel,gridOptions);
        this.addLayer(this.gridLayer);

        this.setLegendData(this.options.legendData);
    },

    /**
     * 设置图层数据，并绘制
     * @method setData
     * @param data {Array}
     */
    setData: function (data) {
        this.gridLayer.setData(data);
    },

    /**
     * 清除图层
     * @method clear
     */
    clear: function () {
        this.setData(null);
        this.fillLayer.clear();
        this.gridLayer.clear();
    },

    resetMask:function (maskGeoJson) {
        this.fillLayer.resetMask(maskGeoJson);
        this.gridLayer.resetMask(maskGeoJson);
    },

    setLegendData: function (legendData) {
        this.fillLayer.setLegendData(legendData);
        this.gridLayer.setLegendData(legendData);
    },

    setFillVisible:function(visible){
        if(!visible && this.hasLayer(this.fillLayer))
            this.removeLayer(this.fillLayer);
        else if(visible && !this.hasLayer(this.fillLayer))
            this.addLayer(this.fillLayer);
    },

    setGridElementVisible: function (element,visible) {
        this.gridLayer.setGridElementVisible(element,visible);
    },
    /**
     * 显示所有， 用于过滤后的恢复
     * @method showAll
     */
    showAll: function () {
        this.gridLayer.showAllRange();
        if(this.gridLayer)
            this.gridLayer.showAllRange();
    },
    /**
     * 过滤 注：若filter的value为无有效值则直接过滤
     * @method filter
     * @param minValue {number} 不填或NaN时仅过滤出比maxValue小的值
     * @param isEqualMin {boolean} 是否将等于minValue的值过滤
     * @param maxValue {number} 不填或NaN时仅过滤出比minValue大的值
     * @param isEqualMax {boolean} 是否将等于maxValue的值过滤
     */
    filter: function (minValue, isEqualMin, maxValue, isEqualMax) {
        this.gridLayer.setDataRange({min:minValue,max:maxValue});
        if(this.fillLayer)
            this.fillLayer.setDataRange({min:minValue,max:maxValue});
    }
});
/**
 *
 * @class LW.GradientGridLayer
 * @constructor
 * @param gridModel {LW.GridModel|LW.GridModelManager} 格点数据模型
 * @param options {object} 外部属性，可重设Properties
 * @param layers {object} 初始图层，可以不传
 * @returns {LW.GradientGridLayer}
 */
LW.gradientGridLayer = function (gridModel,options, layers) {
    return new LW.GradientGridLayer(gridModel,options, layers);
};
LW.GradientLayer = LW.CanvasLayer.extend({
    options: {
        contour:true,
        legendData:[],
        blur:false,
        opacity:0.8,
        gap:2,
        renderer: LW.noTranslateCanvas({interactive:false})
    },
    range:{
        min:NaN,
        max:NaN
    },
    initialize:function(gridModel,options){
        L.setOptions(this,options);
        if(this.options.mask)
            this.setMaskGeojson(this.options.mask);
        this.gridModel = gridModel;
        this.setLegendData(this.options.legendData);
        if(window.Worker && this.options.blur)
            this.worker = new Worker(LW.workerPath + 'blur.js');

        var self = this;
        this.gridModel.on('transform',function(){
            self._update();
        });
    },

    /**
     * 设置图例数据
     * @method setLegendData
     * @param legendData
     */
    setLegendData: function (legendData) {
        if (legendData) {
            this.options.legendData = legendData;
            var segments = Sun.Util.LegendData.getColorSegments(legendData,1,this.options.opacity);
            this.colorScale = Sun.Util.Color.segmentedColorScale(segments);
        }
    },

    /**
     * 设置数据
     * @method setData
     * @param data {ArrayBuffer|json} 数据，可为nc流数据或者json数据
     */
    setData: function (data) {
        if((data instanceof ArrayBuffer && data.byteLength>0) || Object.prototype.toString.call(data).toLowerCase()==="[object object]"){
            this.gridModel.setData(data);
        }
        else{
            this.gridModel.data = null;
            this.clear();
        }
    },


    createBacker: function () {
        var size = this.size;
        var imageData = this._renderer._ctx.getImageData(0, 0, size.x, size.y);
        var data = imageData.data;  // layout: [r, g, b, a, r, g, b, a, ...]
        return {
            imageData: imageData,
            setRGBA: function (x, y, rgba) {
                var i = (y * size.x + x) * 4;
                data[i] = rgba[0];
                data[i + 1] = rgba[1];
                data[i + 2] = rgba[2];
                data[i + 3] = rgba[3];
                return this;
            }
        };
    },

    /**
     * 展示所有范围的值，用于setDataRange后恢复
     * @method showAllRange
     */
    showAllRange:function () {
        this.setDataRange({min:NaN,max:NaN});
    },

    /**
     * 设置数据展示区间
     * @method setDataRange
     * @param range {object} {min:NaN,max:NaN}
     */
    setDataRange:function (range) {
        this.range=range;
        this._update();
    },

    _update: function () {
        if (this.gridModel.data && this._map) {
            // var d1 = Date.now();
            this.clear();
            this._draw();
            // var d2 = Date.now();
            // console.log('gradient update',(d2-d1)/1000+'s');
        }
    },

    _draw : function () {
        if (this.options.contour)
            this.backer = this.createBacker();
        this._batchInterpolate();
        this.showProduct();
        this._renderer.setMask();
    },

    _batchInterpolate:function(){
        var map = this._map, options = this.options, size = this.size;
        var gridModel = this.gridModel,bounds = gridModel.bounds;
        var backer = this.backer,colorScale = this.colorScale;
        var getValue = gridModel.options.wind?this._getUV:this._getValue;
        var range = this.range;

        var _bounds = new L.Bounds(map.latLngToContainerPoint(bounds.getNorthWest()),
            map.latLngToContainerPoint(bounds.getSouthEast()));
        var cBounds = this.cBounds = clampedBounds(_bounds, size);
        this.columns = columnsInterpolate();

        function clampedBounds (bounds, size) {
            var x = Math.max(bounds.min.x, 0);
            var y = Math.max(bounds.min.y, 0);
            var xMax = Math.min(bounds.max.x, size.x);
            var yMax = Math.min(bounds.max.y, size.y);
            return {x: x, y: y, xMax: xMax, yMax: yMax, width: xMax - x + 1, height: yMax - y + 1};
        }

        function columnsInterpolate() {
            var cx = cBounds.x, xMax = cBounds.xMax;
            var cy = cBounds.y, yMax = cBounds.yMax;
            var gap = options.gap;
            var columns = new Array(xMax);
            for (var x = cx; x <= xMax; x += gap) {
                var column = new Array(yMax);
                for (var y = cy; y <= yMax; y += gap) {
                    var coord = map.containerPointToLatLng([x, y]);
                    var color = [255, 255, 255, 0];
                    var value = null;
                    if (coord) {
                        var lng = coord.lng, lat = coord.lat;
                        lng = Math.max(bounds.getWest(), lng);
                        lat = Math.max(bounds.getSouth(), lat);
                        value = gridModel.getInterpolation(lat, lng);
                        if (value != null && isShow(value)) {
                            color = colorScale(getValue(value, options.speedScale));
                        }
                    }
                    // column[y] = column[y + 1] = value;
                    var _gap = gap;
                    while (_gap--)
                        column[y + _gap] = value;

                    if (backer)
                        backer.setRGBA(x, y, color).setRGBA(x + 1, y, color)
                            .setRGBA(x, y + 1, color).setRGBA(x + 1, y + 1, color);
                }
                // columns[x] = columns[x + 1] = column;
                _gap = gap;
                while (_gap--)
                    columns[x + _gap] = column;
            }
            return columns;
        }

        function isShow(value) {
            if(isNaN(range.min) && isNaN(range.max))
                return true;
            else if(isNaN(range.min))
                return value<=range.max;
            else if(isNaN(range.max))
                return value>=range.min;
            else
                return value>=range.min && value<=range.max;
        }
    },


    _getValue:function (value) {
        return value;
    },

    _getUV:function (value,speedScale) {
        var scale = speedScale || 1;
        value[0] = value[0] * scale;
        value[1] = value[1] * scale;
        return value[2];
    },

    showProduct:function () {
        if (this.options.contour) {
            var ctx = this._renderer._ctx;
            var size = this.size;
            if (this.worker) {
                this.worker.onmessage = function (a) {
                    ctx.putImageData(a.data, 0, 0);
                };
                this.worker.postMessage({
                    imageData: this.backer.imageData,
                    width: size.x,
                    height: size.y,
                    radius: 1
                });
            }
            ctx.putImageData(this.backer.imageData, 0, 0);
        }
    }
});

LW.gradientLayer = function (gridModel,options) {
    return new LW.GradientLayer(gridModel,options);
};

/**
 * @module Layer.Plot
 */

/**
 * 数值预报风图层
 *
 * Features :
 *      1. 组合LW.FlowWindLayer和LW.GridLayer
 *      2. 支持单个网格或多个嵌套网格
 *      3. 包含色斑图、流场线、格点值、格点风等
 *      4. 主要是风类数值预报所用图层
 *
 * Update Note：
 *      + v1.0.0 ：Created
 *      + v1.0.4-dev ：
 *          1. gridDistanceScale属性弃用，用gridDistanceMinWidth属性来设置格点间隔
 *          2. 图层未添加在地图上仍可设置数据的功能
 *      + v1.1.0-dev ：增加色斑图不显示时，格点值根据色谱描边的功能
 *      + v1.4.0 : 基于gridModel生成风场
 *      + v1.4.7 : 从LW.GradientGridLayer继承实现
 *
 * @class LW.FlowWindGridLayer
 * @extends L.LayerGroup
 * @demo demo/plot/contour/nwpWind.html  {风类数值预报}
 * @demo demo/other/gifExport.html  {流场导出gif}
 */

LW.FlowWindGridLayer = LW.GradientGridLayer.extend({
    options: {
        /**
         * 网格图层属性
         * @property gridLayerOptions
         * @type {object}
         * @default
         */
        gridOptions: {
            elements:['value','wind'],
            elementsVisible:{value:false,wind:false},
            pane:'gridPane'
        },
        /**
         * 流动风场图层属性
         * @property flowWindLayerOptions
         * @type {object}
         * @default
         */
        flowWindOptions: {
            /**
             * 模糊渲染js地址,可以不传，不传渲染时像素颗粒感会较严重,效果不佳
             * 暂时不使用外部传入路径，使用默认路径即可
             * 废弃属性
             */
            //blurJsUrl: '/blur.js'
        }

    },

    initialize: function (gridModel,options) {
        this._layers = {};
        L.setOptions(this, options);

        var windOptions = this.options.flowWindOptions;
        windOptions.renderer = LW.canvas({maskGeoJson:this.options.maskGeoJson,pane:windOptions.contourPane||'overlayPane',interactive:false});
        windOptions.flowWindRender = LW.canvas({pane:windOptions.windPane||'gridPane',interactive:false});
        this.flowWindLayer = LW.flowWindLayer(gridModel,windOptions);
        this.addLayer(this.flowWindLayer);

        var gridOptions = this.options.gridOptions;
        gridOptions.renderer = LW.canvas({maskGeoJson:this.options.maskGeoJson,pane:gridOptions.pane||'gridPane',interactive:false});
        this.gridLayer = LW.gridLayer(gridModel,gridOptions);
        this.addLayer(this.gridLayer);

        this.setLegendData(this.options.legendData);
    },

    /**
     * 设置图层数据，并绘制
     * @method setData
     * @param data {Array}
     */
    setData: function (data) {
        this.gridLayer.setData(data);
    },

    /**
     * 清除图层
     * @method clear
     */
    clear: function () {
        this.setData(null);
        this.flowWindLayer.clear();
        this.gridLayer.clear();
    },

    resetMask:function (maskGeoJson) {
        this.flowWindLayer.resetMask(maskGeoJson);
        this.gridLayer.resetMask(maskGeoJson);
    },

    setLegendData: function (legendData) {
        this.flowWindLayer.setLegendData(legendData);
        this.gridLayer.setLegendData(legendData);
    },

    setFillVisible:function(visible){
        this.flowWindLayer.setFillVisible(visible);
    },

    /**
     * 设置流场线显隐
     * @method setFlowWindVisible
     * @param value {boolean} 显隐值
     */
    setFlowWindVisible: function (value) {
        // this.flowWindLayer.options.flowWind=value;
        // this.flowWindLayer._update();
        this.flowWindLayer.setFlowWindVisible(value);
    },

    setGridElementVisible: function (element,visible) {
        this.gridLayer.setGridElementVisible(element,visible);
    }
});

/**
 *
 * @class LW.FlowWindGridLayer
 * @constructor
 * @param gridModel {LW.GridModel|LW.GridModelManager} 格点数据模型
 * @param options {object} 外部属性，可重设Properties
 * @param layers {object} 初始图层，可以不传
 * @returns {LW.FlowWindGridLayer}
 */
LW.flowWindGridLayer = function (gridModel,options, layers) {
    return new LW.FlowWindGridLayer(gridModel,options, layers);
};

/**
 * 风场数值预报图层
 * 包括色斑图和流线
 */
LW.FlowWindLayer = LW.GradientLayer.extend({
    options: {
        flowWind: true, //是否有流场
        flowWindColorful: true, //是否是彩色流线
        contour:false,

        gap:5,
        opacity: 0.7,
        maxIntensity: 0.7,
        speedScale: 0.05,//调节流线快慢
        particleMultiplier: 3//调节线条密度
    },

    NULL_VECTOR: [NaN, NaN, null],

    _containsPoint: L.Util.falseFn,

    initialize: function (gridModel,options) {
        LW.GradientLayer.prototype.initialize.call(this,gridModel,options);
        this.flowWindRender = this.options.flowWindRender || LW.noTranslateCanvas();
    },

    onAdd: function () {
        this._renderer = this._map.getRenderer(this);
        this.setFlowWindVisible(this.options.flowWind);
    },
    onRemove: function () {
        if (this._map.hasLayer(this._renderer))
            this._map.removeLayer(this._renderer);
        this.removeRenderer(this.flowWindRender);
    },

    /**
     * 设置渐变色斑地图显隐
     * @method setFillVisible
     * @param value
     */
    setFillVisible: function(value){
        // this[value?'addRenderer':'removeRenderer'](this._renderer);
        if(this.options.contour !== value){
            this.options.contour = value;
            this._update();
        }
    },

    /**
     * 设置流线显隐
     * @method setFlowWindVisible
     * @param value
     */
    setFlowWindVisible: function (value) {
        this.options.flowWind = value;
        this[value?'addRenderer':'removeRenderer'](this.flowWindRender);
        if(value)
            this._update();
    },

    addRenderer: function (renderer) {
        if (this._map && !this._map.hasLayer(renderer))
            this._map.addLayer(renderer);
    },

    removeRenderer: function (renderer) {
        if (this._map && this._map.hasLayer(renderer))
            this._map.removeLayer(renderer);
    },

    /**
     * 清空
     */
    clear: function () {
        if(this._renderer){
            var size = this.size = this._renderer._bounds.getSize();
            this._renderer._ctx.clearRect(0, 0, size.x, size.y);
        }
        if(this.flowWindRender){
            if(this.animation)
                this.animation.field.cancel = true;
            var bounds = this.flowWindRender._bounds;
            if(bounds){
                var size = this.size = bounds.getSize();
                this.flowWindRender._ctx.clearRect(0, 0, this.size.x, this.size.y);
            }
        }
    },

    showProduct:function () {
        LW.GradientLayer.prototype.showProduct.call(this);
        if(this.options.flowWind)
            this._frameAnimate();
    },

    _frameAnimate:function(){
        this.animation = this._createAnimation();
    },

    _createAnimation: function(){
        var options = this.options,cBounds = this.cBounds;
        var ctx = this.flowWindRender._ctx,size = this.size;

        var animation = {};

        var field = animation.field = createField(this.columns,this.cBounds);
        animate(field);

        function createField (columns, bounds) {
            function field(x, y) {
                var column = columns[Math.round(x)];
                return column && column[Math.round(y)] || [NaN, NaN, null];
            }

            field.isDefined = function (x, y) {
                return field(x, y)[2] !== null;
            };

            field.release = function () {
                columns = [];
            };

            field.randomize = function (o) {  // UNDONE: this method is terrible
                var x, y;
                var safetyNet = 0;
                do {
                    x = Math.round(Sun.Util.Math.random(bounds.x, bounds.xMax));
                    y = Math.round(Sun.Util.Math.random(bounds.y, bounds.yMax));
                } while (!field.isDefined(x, y) && safetyNet++ < 2);
                o.x = x;
                o.y = y;
                return o;
            };

            field.cancel = false;

            return field;
        }

        function animate (field) {
            var INTENSITY_SCALE_STEP = 10;
            var PARTICLE_MULTIPLIER = options.particleMultiplier;//调节线条密度
            var PARTICLE_REDUCTION = 0.75;
            var MAX_PARTICLE_AGE = 100;
            var FRAME_RATE = 40;
            var bounds = cBounds;
            // maxIntensity is the velocity at which particle color intensity is maximum
            var colorStyles = options.flowWindColorful ? windIntensityColorfulScale() :
                windIntensityColorScale(INTENSITY_SCALE_STEP,options.maxIntensity);
            var buckets = colorStyles.map(function () {
                return [];
            });
            var particleCount = Math.round(bounds.width * PARTICLE_MULTIPLIER);
            if (L.Browser.mobile) {
                particleCount *= PARTICLE_REDUCTION;
            }
            var fadeFillStyle = Sun.Util.Common.isFF() ? "rgba(255, 255, 255, 0.95)" : "rgba(255, 255, 255, 0.97)";  // FF Mac alpha behaves oddly

            var particles = [];
            for (var i = 0; i < particleCount; i++) {
                particles.push(field.randomize({age: Sun.Util.Math.random(0, MAX_PARTICLE_AGE)}));
            }

            ctx.lineWidth = 1;

            function evolve() {
                buckets.forEach(function (bucket) {
                    bucket.length = 0;
                });
                particles.forEach(function (particle) {
                    if (particle.age > MAX_PARTICLE_AGE) {
                        field.randomize(particle).age = 0;
                    }
                    var x = particle.x;
                    var y = particle.y;
                    var v = field(x, y);  // graph at current position
                    var m = v[2];
                    if (m === null) {
                        particle.age = MAX_PARTICLE_AGE;  // particle has escaped the grid, never to return...
                    }
                    else {
                        var xt = x + v[0];
                        var yt = y + v[1];
                        if (field.isDefined(xt, yt)) {
                            // Path from (x,y) to (xt,yt) is visible, so add this particle to the appropriate draw bucket.
                            particle.xt = xt;
                            particle.yt = yt;
                            buckets[colorStyles.indexFor(m)].push(particle);
                        }
                        else {
                            // Particle isn't visible, but it still moves through the field.
                            particle.x = xt;
                            particle.y = yt;
                        }
                    }
                    particle.age += 1;
                });
            }

            function draw() {
                // Fade existing particle trails.
                ctx.fillStyle = fadeFillStyle;
                var prev = ctx.globalCompositeOperation;
                ctx.globalCompositeOperation = "destination-in";
                ctx.fillRect(0, 0, size.x, size.y);
                ctx.globalCompositeOperation = prev;

                // Draw new particle trails.
                buckets.forEach(function (bucket, i) {
                    if (bucket.length > 0) {
                        ctx.beginPath();
                        ctx.strokeStyle = colorStyles[i];
                        bucket.forEach(function (particle) {
                            ctx.moveTo(particle.x, particle.y);
                            ctx.lineTo(particle.xt, particle.yt);
                            particle.x = particle.xt;
                            particle.y = particle.yt;
                        });
                        ctx.stroke();
                    }
                });
            }

            function windIntensityColorScale (step, maxWind) {
                var result = [];
                for (var j = 185; j <= 255; j += step) {
                    result.push(Sun.Util.Color.asColorStyle(j, j, j, 1.0));
                }
                result.indexFor = function (m) {  // map wind speed to a style
                    return Math.floor(Math.min(m, maxWind) / maxWind * (result.length - 1));
                };
                return result;
            }

            function windIntensityColorfulScale () {
                var legendData =options.legendData;
                var result = [];
                for (var i = 0; i < legendData.length; i++) {
                    result.push(legendData[i].color);
                }
                result.indexFor = function (m) {  // map wind speed to a style
                    return Sun.Util.LegendData.getColorIndex(legendData, m);
                };
                return result;
            }

            (function frame() {
                try {
                    if (field.cancel) {
                        field.release();
                        return;
                    }
                    evolve();
                    draw();
                    setTimeout(frame, FRAME_RATE);
                }
                catch (e) {
                    console.log(e);
                }
            })();
        }

        return animation;
    }
});

LW.flowWindLayer = function (gridModel,options) {
    return new LW.FlowWindLayer(gridModel,options);
};




/**
 * 数据模型
 * @module Layer.Plot
 */
/**
 * 网格图层
 *
 * Features :
 *      1. 根据网格模型填色、填值、风杆等
 *      2. 可设置遮罩
 *
 * Update Note：
 *      + v1.1.0-dev ：Created
 *      + v1.3.0-dev ：将格点值图层和格点填色图层分为两个渲染器渲染
 *      + v1.4.2 : 1. 增加渲染器为L.canvas的支持,为了支持padding属性，提升视觉体验。
 *                 2. 增加网格合并绘制的功能，提升性能体验。
 *                 3. 改变视区外网格过滤的计算，提升性能体验。
 *      + v1.4.7 ：将遮罩改为在渲染器中设置
 *      + v1.5.2 ：增加网格线显示的配置
 *
 * @class LW.GridLayer
 * @extends LW.CanvasLayer
 * @demo demo/gridEdit/gridEdit.html {格点编辑}
 */
LW.GridLayer = LW.CanvasLayer.extend({
    options:{
        /**
         * 格点的要素，可有数值--value,风杆--wind,网格填色--fill,箭头--arrow
         * @property elements
         * @type {Array}
         * @default ['value']
         */
        elements:['value'],
        /**
         * 要素的显影
         * @property elements
         * @type {Object}
         * @default {value:true,wind:false,fill:false,arrow:false}
         */
        elementsVisible:{value:true,wind:false,fill:false,arrow:false},

        /**
         * 是否展示网格线
         * @type {Boolean}
         * @property gridLine
         * @default false
         */
        gridLine:false,

        /**
         * 网格线颜色
         * @type {string}
         * @property gridLineColor
         * @default '#73B4F2'
         */
        gridLineColor:'#73B4F2',

        /**
         * 网格线显示等级范围
         * @type {Array}
         * @property gridLineZooms
         * @default [6,18]
         */
        gridLineZooms:[6,18],
        /**
         * 图例数据
         * @property elements
         * @type {Array}
         */
        legendData:[],
        /**
         * 格点值颜色
         * @type {String}
         * @property valueColor
         * @default '#222'
         */
        valueColor: '#222',
        valueStroke: '#fff',
        /**
         * 格点值字体
         * @type {String}
         * @property font
         * @default '14px  Microsoft YaHei'
         */
        font:'14px Microsoft YaHei',
        /**
         * 格点风是否根据色谱填色
         * @type {Boolean}
         * @property gridWindColorful
         * @default false
         */
        gridWindColorful:false,
        /**
         * 格点风线宽
         * @type {Int}
         * @property windWidth
         * @default 1
         */
        gridWindLineWidth:1,
        /**
         * 格点最小间隔的宽度，单位px
         * @property distanceWidth
         * @type {Number}
         * @default 40
         */
        distanceWidth: 40,

        /**
         * 格点位置
         *      1. 'center'--格点的中心为格点的经纬度
         *      2. 'leftbottom'--格点的左下为格点的经纬度
         * @property gridPosition
         * @type {string}
         * @default 'center'
         */
        gridPosition:'center',

        /**
         * 格点的最大最小等级
         */
        gridZooms:[3,18],

        /**
         * 是否网格合并绘制，以提高性能
         * @property mergerDraw
         * @type {Boolean}
         * @default true
         */
        mergerDraw:true,
        /**
         * 网格渲染器
         * Tip:一个渲染器即一个canvas，若项目中有多个这个图层，一定要新建渲染器
         * @property renderer
         * @type {L.Canvas}
         * @default L.canvas()
         */
        renderer:L.canvas(),
        /**
         * 填色渲染器
         * Tip:一个渲染器即一个canvas，若项目中有多个这个图层，一定要新建渲染器
         * @property fillRenderer
         * @type {L.Canvas}
         * @default L.canvas()
         */
        fillRenderer:L.canvas()
    },

    range:{
        min:NaN,
        max:NaN
    },

    initialize:function (gridModel,options) {
        L.setOptions(this, options);
        if(this.options.elements.indexOf('fill')!=-1){
            this._fillRenderer = this.options.fillRenderer;
        }
        this.gridModel = gridModel;
        var self = this;
        this.gridModel.on('transform',function(){
            self._update();
        });
    },
    beforeAdd: function (map) {
        this._map = map;
        if (this._fillRenderer && !this._map.hasLayer(this._fillRenderer))
            this._map.addLayer(this._fillRenderer);
        L.Path.prototype.beforeAdd.call(this,map);
    },

    onRemove: function () {
        LW.CanvasLayer.prototype.onRemove.call(this);
        if (this._fillRenderer && this._map.hasLayer(this._fillRenderer))
            this._map.removeLayer(this._fillRenderer);
    },

    clear: function () {
        if(this._renderer){
            var bounds = this._renderer._bounds,size = bounds.getSize();
            if(this._renderer instanceof LW.NoTranslateCanvas)
                bounds = L.bounds([0,0],size);
            this._renderer._ctx.clearRect(bounds.min.x, bounds.min.y, size.x, size.y);
        }
        if(this._fillRenderer)
            this._fillRenderer._ctx.clearRect(bounds.min.x, bounds.min.y, size.x, size.y);
    },

    /**
     * 设置格点要素的显影
     * @method setGridElementVisible
     * @param element {String} 可选择options.elements中的要素
     * @param visible {Boolean}
     */
    setGridElementVisible: function (element,visible) {
        if(this.options.elementsVisible[element] !== visible){
            this.options.elementsVisible[element] = visible;
            this._update();
        }
    },

    /**
     * 设置图例数据
     * @method setLegendData
     * @param legendData
     */
    setLegendData: function (legendData) {
        this.options.legendData=legendData;
    },

    /**
     * 设置遮罩
     * @method setMask
     * @param mask
    */

    setMask:function(maskGeoJson){
        this.options.renderer.options.maskGeoJson = maskGeoJson;
        this.options.fillRenderer.options.maskGeoJson = maskGeoJson;
        this._update();
    },


    /**
     * 设置数据
     * @method setData
     * @param data {ArrayBuffer|json} 数据，可为nc流数据或者json数据
     * @param applyRegions {Array} [可选] 设置应用的区域
     *          一维网格。若设定区域时，指定区域对应的网格设置新的数据，非该指定的区域，保留原先网格值，需要有设置好的options.regionGrid
     * @param keepValidGrid {Boolean} [可选] 是否保留原先网格的有效值，若新数据的某个网格为无效值时，保留原先网格值
     * @param applyWindSpeed {Boolean} [可选] 该参数用于options.wind为true,但应用的数据只希望应用风速时使用
     */
    setData: function (data,applyRegions,keepValidGrid,applyWindSpeed) {
        if(!data){
            this.gridModel.data = null;
            this.clear();
            return;
        }
        if(data.isGrid)
            this.gridModel.resetGrid(data.grid,data.editedKeys);
        else if((data instanceof ArrayBuffer && data.byteLength>0) || Object.prototype.toString.call(data).toLowerCase()==="[object object]"){
            this.gridModel.setData(data,applyRegions,keepValidGrid,applyWindSpeed);
            // this._showBounds();
        }
    },

    _showBounds:function () {
        var data = this.gridModel.data.data;
        for(var key in data){
            var item = data[key];
            var bound = L.latLngBounds([[item.startlat,item.startlon],[item.endlat,item.endlon]]);
            L.rectangle(bound,{fill:false}).addTo(map);
            LW.labelMarker(bound.getCenter()).addTo(map).setData(key);
        }
    },

    /**
     * 重设模型的gird数据
     * @method resetGrid
     * @param grid {Array} 二维格点数据
     */
    resetGrid: function (grid) {
        this.gridModel.resetGrid(grid);
    },

    /**
     * 展示所有范围的值，用于setDataRange后恢复
     * @method showAllRange
     */
    showAllRange:function () {
        this.setDataRange({min:NaN,max:NaN});
    },

    /**
     * 设置数据展示区间
     * @method setDataRange
     * @param range {object} {min:NaN,max:NaN}
     */
    setDataRange:function (range) {
        this.range=range;
        this._update();
    },

    _update: function () {
        if (this.gridModel.data && this._map) {
            // var t1 = new Date();
            this.clear();
            this._draw();
            // var t2 = new Date();
            // console.log('grid update:',(t2.getTime()-t1.getTime())/1000+'s');
        }
    },

    _draw : function () {
        var data = this.gridModel.data;
        var map = this._map,options = this.options,zoom = map.getZoom();
        var renderer = this._renderer,ctx = renderer._ctx,bounds = renderer._bounds;
        var range = this.range;
        var maskCoords = this.maskCoords;
        var transformFn = renderer instanceof LW.NoTranslateCanvas ? 'latLngToContainerPoint' : 'latLngToLayerPoint';
        if(renderer instanceof LW.NoTranslateCanvas)
            bounds = L.bounds([0,0],bounds.getSize());
        if(this._fillRenderer){
            var fillRenderer = this._fillRenderer;
            var fillCtx = this._fillRenderer._ctx;
            fillCtx.globalAlpha = options.opacity;
        }

        if(this.gridModel instanceof LW.GridModel){
            _drawData(data,this.gridModel);
            _setMask();
        }
        else if(this.gridModel instanceof LW.GridModelManager){
            for(var key in data.data){
                _drawData(data.data[key],this.gridModel.gridModels[key]);
            }
            _setMask();
        }

        function _drawData(data,gridModel) {
            if(data){
                var x0 = parseFloat(data.startlon), y0 = parseFloat(data.startlat);
                var x1 = parseFloat(data.endlon), y1 = parseFloat(data.endlat);
                var dx = parseFloat(data.nlon), dy = parseFloat(data.nlat);
                var xs = parseFloat(data.lonsize)-1,ys = parseFloat(data.latsize)-1;
                var _bounds = L.bounds(map[transformFn]([y0,x0]),map[transformFn]([y1,x1]));
                if(!_bounds.overlaps(bounds))
                    return;// 数据边界和视区边界无交集，无需绘制

                var grid = gridModel.grid;
                var continuous = gridModel.options.continuous;
                var bIdx = getBoundIdx();
                if(_ElementVisble('fill'))
                    _eachDraw();
                if(options.gridLine && zoom >= options.gridLineZooms[0] && zoom <= options.gridLineZooms[1])
                    _drawLine();
                if(zoom >= options.gridZooms[0] && zoom <= options.gridZooms[1]){//zoom在规定的等级内
                    if((_ElementVisble('value') || _ElementVisble('wind') || _ElementVisble('arrow')))
                        _gapDraw();
                }
            }


            function _hasElement(element) {
                return options.elements.indexOf(element)!==-1;
            }

            function _ElementVisble(element) {
                return options.elements.indexOf(element)!==-1 && options.elementsVisible[element];
            }

            function _eachDraw() {
                for (var i = bIdx.row_min; i <= bIdx.row_max; i++) {
                    var row = grid[i];
                    for (var j = bIdx.column_min; j <= bIdx.column_max; j++) {
                        var gValue = _getValue(row[j]);
                        if (_isShowGrid(gValue.value) && !gridModel.isHide(row[j])) {
                            var lat = y0 + dy * i, lng = x0 + dx * j;
                            var latLng1 = options.gridPosition === 'center' ? L.latLng(lat - dy / 2, lng - dx / 2) : L.latLng(lat, lng);
                            var latLng2 = options.gridPosition === 'center' ? L.latLng(lat + dy / 2, lng + dx / 2) : L.latLng(lat + dy, lng + dx);
                            // Tip:由于麦卡托不同纬度下单位纬度间隔的距离不一致，所以需要每次重算，然而distanceTo方法太耗性能，所以用点的xy直接计算
                            // var p = map.latLngToContainerPoint(latLng1);
                            // var p_next = map.latLngToContainerPoint(latLng2);
                            var p = map[transformFn](latLng1);
                            var p_next = map[transformFn](latLng2);
                            var dw = p_next.x - p.x;
                            var dh = p_next.y - p.y;

                            // if (p.x + Math.abs(dw) >= bounds.min.x && p.y + Math.abs(dh) >= bounds.min.y &&
                            //     p.x - Math.abs(dw) <= bounds.max.x && p.y - Math.abs(dh) <= bounds.max.y) {//在视区范围内
                                if(!options.mergerDraw)
                                    _drawRect(gValue, p, dw, dh);
                                else{
                                    var cellNext = j < bIdx.column_max ? row[j + 1] : null, cellPrev = j > bIdx.column_min ? row[j - 1] : null;
                                    var nextHide = cellNext ? (!_isShowGrid(_getValue(cellNext).value) || gridModel.isHide(cellNext)) : false;
                                    var prevHide = cellPrev ? (!_isShowGrid(_getValue(cellPrev).value) || gridModel.isHide(cellPrev)) : false;
                                    //var rowEnd = p.x >= bounds.max.x;// 边界一些奇怪的情况，不等有的时候最后无法画出，等于有的时候又会多绘制一次
                                    _drawRect(gValue, p, dw, dh,options.mergerDraw,
                                        j === bIdx.column_min || prevHide,
                                        j === bIdx.column_max  || nextHide);
                                    //if (rowEnd) break;
                                }
                            // }
                        }
                    }
                }
            }

            function _drawLine() {
                if (!fillCtx) return;
                fillCtx.strokeStyle = options.gridLineColor;
                fillCtx.lineWidth = 1;
                var row_max = bIdx.row_max+1,column_max = bIdx.column_max+1;
                for (var i = 0; i <= row_max; i++) {
                    var lat = y0 + dy * i, lng1 = x0 + dx * bIdx.column_min, lng2 = x0 + dx * column_max;
                    var latLng1 = options.gridPosition === 'center' ? L.latLng(lat - dy / 2, lng1 - dx / 2) : L.latLng(lat, lng1);
                    var latLng2 = options.gridPosition === 'center' ? L.latLng(lat - dy / 2, lng2 - dx / 2) : L.latLng(lat, lng2);
                    var p1 = map[transformFn](latLng1),
                        p2 = map[transformFn](latLng2);
                    fillCtx.moveTo(p1.x,p1.y);
                    fillCtx.lineTo(p2.x,p2.y);
                }
                for (var j = 0; j <= column_max; j++) {
                    var lat1 = y0 + dy * bIdx.row_min,lat2 = y0 + dy * row_max, lng = x0 + dx * j;
                    latLng1 = options.gridPosition === 'center' ? L.latLng(lat1 - dy / 2, lng - dx / 2) : L.latLng(lat1, lng);
                    latLng2 = options.gridPosition === 'center' ? L.latLng(lat2 - dy / 2, lng - dx / 2) : L.latLng(lat2, lng);
                    p1 = map[transformFn](latLng1);
                    p2 = map[transformFn](latLng2);
                    fillCtx.moveTo(p1.x,p1.y);
                    fillCtx.lineTo(p2.x,p2.y);
                }
                fillCtx.stroke();
            }

            function _gapDraw() {
                // 渲染间隔 Tip: map的latLngToLayerPoint是保留整数。计算的精度误差导致效果不好
                var p1 = latLngToLayerPoint(L.latLng(y0, x0));
                var p2 = latLngToLayerPoint(L.latLng(y0, x0 + dx));
                var d = p1.distanceTo(p2);
                var xi = options.distanceWidth / d;//Tip:因文本为横向，所以采用xi间隔，宽松点更好看
                xi = xi < 1 ? 1 : xi;
                xi = xi > (grid.length - 1) / 2 ? (grid.length - 1) / 2 : xi;
                xi = Math.ceil(xi);


                //Tip：为了保证拖动地图时，网格值不会因为起始不一致而跳动，导致体验不好，牺牲一点性能，索引不从row_min/column_min开始
                for (var i = 0; i <= bIdx.row_max; i += xi) {
                    var row = grid[i];
                    for (var j = 0; j <= bIdx.column_max; j += xi) {
                        var gValue = _getValue(row[j]);
                        if(_isShowGrid(gValue.value) && !gridModel.isHide(row[j])){
                            var latLng = L.latLng(y0 + dy * i, x0 + dx * j);
                            // var p = map.latLngToContainerPoint(latLng);
                            var p = map[transformFn](latLng);
                            if (p.x > bounds.min.x && p.y > bounds.min.y
                                && p.x < bounds.max.x && p.y < bounds.max.y) {
                                if (_hasElement('wind'))
                                    _drawWind(gValue, p);
                                else if(_hasElement('arrow'))
                                    _drawArrow(gValue,p);
                                else if(_hasElement('value'))
                                    _drawValue(gValue, p);
                            }
                        }
                    }
                }
            }

            function latLngToLayerPoint (latlng) {
                var projectedPoint = map.project(L.latLng(latlng));
                return projectedPoint._subtract(map.getPixelOrigin());
            }

            function getBoundIdx() {
                var tFn = renderer instanceof LW.NoTranslateCanvas ? 'containerPointToLatLng' : 'layerPointToLatLng';
                var latlngBounds = L.latLngBounds(map[tFn](bounds.min),map[tFn](bounds.max));
                var se = gridModel.get4GridsIndexByLatlng(latlngBounds.getSouthEast());
                var nw = gridModel.get4GridsIndexByLatlng(latlngBounds.getNorthWest());
                var row_min = Math.min(se.f_row,nw.f_row),
                    row_max = Math.max(se.c_row,nw.c_row),
                    column_min = Math.min(se.f_column,nw.f_column),
                    column_max = Math.max(se.c_column,nw.c_column);
                row_min  = row_min < 0 ? 0 : row_min;
                row_max  = row_max > ys ? ys : row_max;
                column_min  = column_min < 0 ? 0 : column_min;
                column_max  = column_max > xs ? xs : column_max;
                return {row_min:row_min,row_max:row_max,column_min:column_min,column_max:column_max};
            }

            function _isShowGrid(value) {
                if(isNaN(range.min) && isNaN(range.max))
                    return true;
                else if(isNaN(range.min))
                    return value<=range.max;
                else if(isNaN(range.max))
                    return value>=range.min;
                else
                    return value>=range.min && value<=range.max;
            }

            function _getValue(grid) {
                var value = typeof grid == "object" ? grid : {value:grid};
                var valid = !gridModel.isInvalid(value.value || value);
                value.valid = valid;
                // var value = {value:grid,valid:valid};
                if(_hasElement('wind') || _hasElement('arrow')){
                    var wind = valid?Sun.Util.Weather.wind_getWindByUV(grid,data.precision):{speed:data.invalidValue,dir:data.invalidValue};
                    value = {value:wind.speed,dir:wind.dir,valid:valid};
                }
                return value;
            }

            function _drawValue(value, p,yOffset) {
                if (!ctx) return;
                if (options.elementsVisible.value){
                    yOffset = yOffset || 5;
                    ctx.font = options.font;
                    ctx.fillStyle = options.valueColor;
                    ctx.textAlign = "center";
                    if (options.valueStroke) {
                        ctx.strokeStyle = options.valueStroke;
                        ctx.lineWidth = 2;
                        ctx.strokeText(value.value, p.x, p.y + yOffset);
                    }
                    ctx.fillText(value.value, p.x, p.y + yOffset);
                }
            }

            function _drawWind(value, p) {
                if (!ctx) return;
                _drawValue(value,p,10);
                ctx.lineWidth = options.gridWindLineWidth||1;
                ctx.strokeStyle = options.gridWindColorful?
                    Sun.Util.LegendData.getColorOfRangeLegend(options.legendData, value.value):options.valueColor;
                if (options.elementsVisible.wind && value.valid)
                    Sun.Util.Geometry.drawWindByPosition(ctx, value.value, value.dir, p);
            }

            function _drawArrow(value, p) {
                if (!ctx) return;
                _drawValue(value,p,10);
                ctx.strokeStyle = options.valueColor;
                if (options.elementsVisible.arrow && value.valid)
                    Sun.Util.Geometry.drawArrow(ctx, p, value.dir-180);
            }

            var s_x,width,prevColor;
            function _drawRect(value,p,w,h,unionDraw,rowStart,rowEnd) {
                if (!fillCtx) return;
                var getColorFun = continuous?Sun.Util.LegendData.getColorOfRangeLegend:Sun.Util.LegendData.getColor;
                var color = value.valid?getColorFun(options.legendData,value.value,'#ffffff00'):'#ffffff00';
                if(!unionDraw){
                    fillCtx.fillStyle = color;
                    fillCtx.fillRect(p.x, p.y,w,h/*-data.latSign*/);
                }
                else{
                    if(rowStart)
                        reset();
                    else if(prevColor === color)
                        width+=w;
                    else if(prevColor !== color){
                        fillCtx.fillStyle = prevColor;
                        fillCtx.fillRect(s_x, p.y,width,h/*-data.latSign*/);
                        reset();
                    }
                    if(rowEnd && prevColor === color){
                        fillCtx.fillStyle = prevColor;
                        fillCtx.fillRect(s_x, p.y,width,h/*-data.latSign*/);
                    }
                }
                // fillCtx.strokeRect(p.x, p.y,w,h/*-data.latSign*/);

                function reset() {
                    s_x = p.x;
                    width = w;
                    prevColor = color;
                }
            }
        }

        function _setMask() {
            renderer.setMask();
            if(fillRenderer)
                fillRenderer.setMask();
        }
    }
});

/**
 * @class LW.GridLayer
 * @constructor
 * @param gridModel {LW.GridModel|LW.GridModelManager} 格点数据模型
 * @param options {object} 外部属性，可重设Properties
 * @returns {LW.GridLayer}
 */
LW.gridLayer = function (gridModel,options) {
    return new LW.GridLayer(gridModel,options);
};


/**
 * 经纬网格线图层
 *
 * Features :
 *      1. 根据配置的等级经纬间隔展示经纬线网格线
 *      2. 根据设置的文本范围展示经纬信息文本
 *
 * Update Note：
 *      + v1.5.2 ：Created
 *
 * @class LW.GridLineLayer
 * @extends L.FeatureGroup
 * @demo demo/plot/grid/gridline.html {经纬网格线}
 *
 */
LW.GridLineLayer = L.FeatureGroup.extend({
    options: {
        /**
         * 经纬网格线的样式
         * @property style
         */
        style: {
            color: '#4454F7',
            weight: 1,
            dashArray:'5,5',
            opacity: 1,
            outOfBox:true,
            renderer:L.canvas()
        },
        /**
         * 经纬度文字的样式
         * @property labelStyle
         */
        labelStyle:{
            textAnchor:{
                s:[42, 18],
                n:[0, 0],
                w:[-2, 18],
                e:[40, 18]
            },
            textAlign:{s:'right',n:'left',w:'left',e:'right'},
            visible:{s:true,n:true,w:true,e:true},
            scale:false,
            color:'#0820FE',
            fontSize:'12px'
        },
        /**
         * 所需要显示的经纬像素网格左上和右下的位置
         * @property labelBox
         */
        labelBox:[[100,100],[900,900]],
        /**
         * 不同等级经纬间隔的显示配置
         * @property zoomInterval
         */
        zoomInterval: [//equalMin
            {min: 0, max: 2, interval: 20},
            {min: 2, max: 4, interval: 10},
            {min: 4, max: 6, interval: 5},
            {min: 6, max: 7, interval: 2},
            {min: 7, max: 9, interval: 1},
            {min: 9, max: 10, interval: 0.5},
            {min: 10, max: 11, interval: 0.2},
            {min: 11, max: 13, interval: 0.05},
            {min: 13, max: 14, interval: 0.02},
            {min: 14, max: 18, interval: 0.01}
        ]
    },

    initialize: function (options) {
        options.labelStyle = L.extend({}, this.options.labelStyle,options.labelStyle);
        L.setOptions(this, options);
        this._layers = {};
        this.craticuleLayer = L.geoJSON(null,this.options.style).addTo(this);
        this.labelLayer = L.featureGroup().addTo(this);
    },

    onAdd: function (map) {
        this._map = map;
        L.GeoJSON.prototype.onAdd.call(this,map);
        map.on('moveend', this._reset, this);
        this._reset();
    },

    onRemove: function (map) {
        L.GeoJSON.prototype.onRemove.call(this,map);
        map.off('moveend', this._reset, this);
        this._map = null;
    },

    setLineVisible:function(visible){
        if (visible && !this._map.hasLayer(this.craticuleLayer))
            this._map.addLayer(this.craticuleLayer)
        else if(!visible && this._map.hasLayer(this.craticuleLayer))
            this._map.removeLayer(this.craticuleLayer);
    },

    setLineStyle:function(style){
        this.craticuleLayer.resetOptionsStyle(style);
    },

    setLabelStyle:function(style){
        this.options.labelStyle = L.extend({}, this.options.labelStyle,style);
        this._reset();
    },

    setLabelBox:function(labelBox){
        this.options.labelBox = labelBox;
        this._reset();
    },

    _reset: function(){
        var map = this._map;
        if(map){
            var zoom = map.getZoom(),labelBox = this.options.labelBox;
            var bounds = this.options.style.outOfBox?map.getBounds() :
                L.latLngBounds(map.containerPointToLatLng(labelBox[0]),map.containerPointToLatLng(labelBox[1]));
            if(!bounds.equals(this.mapBounds)){
                this.mapBounds = bounds;
                var zoomInterval = this.options.zoomInterval;
                var interval;
                for(var i=0;i<zoomInterval.length;i++){
                    var item = zoomInterval[i];
                    if(zoom>=item.min && zoom<item.max){
                        interval = item.interval;
                        break;
                    }
                }
                var data = this.data = interval ? this._getGraticule(interval,bounds) : null;
                this.craticuleLayer.setData(data);
            }
            this._setLabelData(this.data,L.latLngBounds(map.containerPointToLatLng(labelBox[0]),map.containerPointToLatLng(labelBox[1])));
        }
    },

    _setLabelData: function(data,bounds){
        this.labelLayer.clearLayers();
        if(data){
            var self = this,style = this.options.labelStyle;
            for(var i=0;i<data.features.length;i++){
                var item = data.features[i];
                var name = item.properties.name,text = '';
                if(isDir(name,'E')|| isDir(name,'W')){
                    text = isDir(name,'WE') ? '0' : (isDir(name,'W') ? name.slice(1) : name);
                    if(style.visible.s)
                        addLabel([bounds.getSouth(),parseFloat(name)],{iconAnchor: L.point(style.textAnchor.s),textAlign:style.textAlign.s},text,90);
                    if(style.visible.n)
                        addLabel([bounds.getNorth(),parseFloat(name)],{iconAnchor: L.point(style.textAnchor.n),textAlign:style.textAlign.n},text,90,[4,0]);
                }
                else if(isDir(name,'S')|| isDir(name,'N')){
                    text = isDir(name,'NS') ? '0' : (isDir(name,'S') ? name.slice(1) : name);
                    if(style.visible.w)
                        addLabel([parseFloat(name),bounds.getWest()],{iconAnchor: L.point(style.textAnchor.w),textAlign:style.textAlign.w},text,0,[0,4]);
                    if(style.visible.e)
                        addLabel([parseFloat(name),bounds.getEast()],{iconAnchor: L.point(style.textAnchor.e),textAlign:style.textAlign.e},text);
                }
            }
        }

        function isDir(name,dir) {
            return name.indexOf(dir) !== -1;
        }

        function addLabel(latlng, options, text, rotation, anchor) {
            if(bounds.contains(latlng)){
                L.extend(options,{color: style.color,fontSize:style.fontSize,edge:false});
                LW.labelMarker(latlng,{iconOptions: options}).setData(text).addTo(self.labelLayer);
                if(style.scale)
                    LW.labelMarker(latlng,{iconOptions: {color: style.color,iconSize: L.point(8, 8),iconAnchor: L.point(anchor)}})
                        .setData('━',rotation).addTo(self.labelLayer);
            }
        }
    },

    _getFrame: function() {
        return { "type": "Polygon",
            "coordinates": [
                this._getMeridian(-180).concat(this._getMeridian(180).reverse())
            ]
        };
    },

    _getGraticule: function (interval,bounds) {
        var features = [];

        var w = bounds.getWest(),e = bounds.getEast(),s = bounds.getSouth(),n=bounds.getNorth(),gap = interval;
        if(interval<1){
            var precision = (1/interval).toString().length;
            w = w*10*precision,e=e*10*precision,s=s*10*precision,n=n*10*precision;
            gap = gap*10*precision;
        }
        // Meridians
        var lng0 = Math.ceil(w/gap)*interval,lng1 = Math.floor(e/gap)*interval;
        for (var lng = lng0; lng <= lng1; lng = lng + interval) {
            if(interval<1)
                lng = Sun.Math.round(lng,precision);
            features.push(this._getFeature(this._getMeridian(lng), {
                "name": lng.toString() + (lng ? (lng>0?'E':'W'):'WE')
            }));
        }

        // Parallels
        var lat0 = Math.ceil(s/gap)*interval,lat1 = Math.floor(n/gap)*interval;
        for (var lat = lat0; lat <= lat1; lat = lat + interval) {
            if(interval<1)
                lat = Sun.Math.round(lat,precision);
            features.push(this._getFeature(this._getParallel(lat), {
                "name": lat.toString() + (lat ? (lat>0?'N':'S'):'NS')
            }));
        }

        return {
            "type": "FeatureCollection",
            "features": features
        };
    },

    _getMeridian: function (lng) {
        lng = this._lngFix(lng);
        var coords = [];
        var bounds = this.mapBounds;
        var start = bounds.getSouth(), end = bounds.getNorth(),
        // var start = -90, end = 90,
            gap = (end-start)/2;
        for (var i = 0; i <= 2; i++) {//若是兰伯特投影，则经纬应为间隔1，加密经纬线的点集
            coords.push([lng, start+gap*i]);
        }
        return coords;
    },

    _getParallel: function (lat) {
        var coords = [];
        var bounds = this.mapBounds;
        var start = bounds.getWest(), end = bounds.getEast(),
            // var start = -180, end = 180,
            gap = (end-start)/2;
        for (var i = 0; i <= 2; i++) {
            var lng = start+gap*i;
            coords.push([this._lngFix(lng), lat]);
        }
        return coords;
    },

    _getFeature: function (coords, prop) {
        return {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": coords
            },
            "properties": prop
        };
    },

    _lngFix: function (lng) {
        if (lng >= 180) return 179.999999;
        if (lng <= -180) return -179.999999;
        return lng;
    }

});
/**
 * @class LW.GridLineLayer
 * @constructor
 * @param options {object} 外部属性，可重设Properties
 * @returns {LW.GridLineLayer}
 */
LW.gridLineLayer = function (options) {
    return new LW.GridLineLayer(options);
};

(function () {

    var transition = {
        point2latlng: function(x, t) {
            var e = this.getR(t);
            return L.latLng(360 * Math.atan(Math.pow(Math.E, x.y / e)) / Math.PI - 90, x.x / t)
        },
        latlng2point:function(latlng, t) {
            var e = this.getR(t);
            return L.point(latlng.lng * t, e * Math.log(Math.tan(Math.PI / 4 + latlng.lat * Math.PI / 360)))
        },
        getR:function(x) {
            return 180 / Math.PI * x;
        }
    };

    {
        L.LatLng.prototype.offset = function(x) {
            return L.latLng(this.lat - x.lat, this.lng - x.lng);
        }
        L.LatLng.div = function(latlng,t){
            return L.point(latlng.lng / t, latlng.lat / t);
        };
        L.Point.mul = function(x, t) {
            return L.latLng(x.y * t, x.x * t);
        };
    }

    var gradient = function (steps, legend) {
        this.steps = steps;
        this.gradient = legend;
        this.colors = null;
        this.setMinMax()
    };
    gradient.prototype = {
        setColors: function (x) {
            this.wasModified || (this.defaultGradient = utils.clone(this.gradient)),
                this.wasModified = !0,
                this.gradient = x,
                this.setMinMax(),
            this.colors && this.forceGetColor()
        },
        setMinMax : function () {
            this.min = this.gradient[0][0];
            this.max = this.gradient[this.gradient.length - 1][0];
        },
        forceGetColor : function () {
            return this.colors = null,
                this.getColor()
        },
        color : function (x, t, e) {
            var _ = this.RGBA(x);
            return "rgba(" + _[0] + "," + _[1] + "," + _[2] + "," + (t || _[3] / (e || 256)) + ")"
        },
        colorInvert : function (x, t, e) {
            var _ = this.RGBA(x);
            return "rgba(" + (255 - _[0]) + "," + (255 - _[1]) + "," + (255 - _[2]) + "," + (t || _[3] / (e || 256)) + ")"
        },
        colorRGB : function (x) {
            var t = this.RGBA(x);
            return "rgb( " + t[0] + ", " + t[1] + ", " + t[2] + ")"
        },
        colorDark : function (x, t) {
            var e = this.RGBA(x);
            return "rgba(" + (e[0] - t) + "," + (e[1] - t) + "," + (e[2] - t) + ",1)"
        },
        RGBA : function (x) {
            var t = this.value2index(x);
            return [this.colors[t], this.colors[++t], this.colors[++t], this.colors[++t]]
        },
        getMulArray : function (color, t) {
            var i, data = [], len = color.length;
            for (i = 0; i < len; i++)
                data.push(color[i] * t);
            return data
        },
        lerpArray : function (color0, color1, scale) {
            var i, _scale = 1 - scale, len = color0.length, data = [];
            for (i = 0; i < len; i++) {
                data.push(color0[i] * _scale + color1[i] * scale)
            }
            return data
        },
        rgb2yuv : function (color) {
            var data = [], e = .299 * color[0] + .587 * color[1] + .114 * color[2];
            data.push(e);
            data.push(.565 * (color[2] - e));
            data.push(.713 * (color[0] - e));
            data.push(color.slice(3));
            return data;
        },
        yuv2rgb : function (color) {
            return [color[0] + 1.403 * color[2], color[0] - .344 * color[1] - .714 * color[2], color[0] + 1.77 * color[1]].concat(color.slice(3));
        },
        gradYuv : function (color0, color1, scale, _) {// _ = true
            var lerp = this.lerpArray(color0, color1, scale);
            if (_) {
                var s1 = this.vec2size(color0[1], color0[2]),
                    s2 = this.vec2size(color1[1], color1[2]);
                if (s1 > .05 && s2 > .05) {
                    var s = this.vec2size(lerp[1], lerp[2]),
                        _s = s1 * (1 - scale) + s2 * scale;
                    if (s > .01) {
                        var l = _s / s;
                        lerp[1] *= l;
                        lerp[2] *= l;
                    }
                }
            }
            return lerp
        },
        vec2size : function (x, t) {
            return Math.sqrt(x * x + t * t);
        },
        getGradientColor : function (type, color0, color1, scale, i) {
            var color, a = 1, s = 256;
            switch (type) {
                case "YUV":
                    var _color = this.gradYuv(this.rgb2yuv(this.getMulArray(color0, 1 / 255)), this.rgb2yuv(this.getMulArray(color1, 1 / 255)), scale, true);
                    color = this.yuv2rgb(_color);
                    break;
                default:
                    color = this.lerpArray(color0, color1, scale),
                        a = 1 / 255,
                        s = 1
            }
            for (var d = color[3] * a, j = 0; j < 4; j++) {
                var l = color[j];
                i && j < 3 && (l *= d),
                    color[j] = Math.max(0, Math.min(l * s, 255))
            }
            return color
        },
        createGradientArray : function (type, t, e, steps, b) {// t = false,e = true
            steps = steps || this.steps, b = b || 1;
            var n = new Uint8Array(4 * (steps + (t ? 1 : 0))), a = 0, s = (this.max - this.min) / steps,
                legend = this.gradient,
                d = 1, color0 = legend[0], color1 = legend[d++];
            for (var i = 0; i < steps; i++) {
                var value = (this.min + s * i) * b;
                value > color1[0] && d < legend.length && (color0 = color1,
                    color1 = legend[d++]);
                var scale = (value - color0[0]) / (color1[0] - color0[0]),
                    u = this.getGradientColor(type, color0[1], color1[1], scale, e);
                for (var g = 0; g < 4; g++)
                    n[a++] = u[g]
            }
            if (t) {
                for (this.neutralGrayIndex = a, g = 0; g < 4; g++)
                    n[a++] = 130;
            }
            return n;
        },
        getColor : function () {
            return this.colors ? this : (this.colors = this.createGradientArray("YUV", false, true),
                this.startingValue = this.min,
                this.step = (this.max - this.startingValue) / this.steps,
                this.value2index = function (x) {
                    return isNaN(x) ? this.neutralGrayIndex : Math.max(0, Math.min(4 * (this.steps - 1), (x - this.startingValue) / this.step << 2));
                }
                , this)
        }
    };


    /**
     * 渐变webgl网格图层
     *
     * Features :
     *      1. 基于webgl实现
     *      2. 基于GridInt16流数据
     *
     * Update Note：
     *      + v1.5.2 ：Created
     *
     * @class LW.GradientGlLayer
     * @extends L.CanvasLayer
     * @demo demo/plot/contour/gradientWebglLayer.html {渐变Gl图层}
     */
    LW.GradientGlLayer = LW.CanvasLayer.extend({
        options: {
            legendData:null,
            opacity:0.8,
            /**
             * 格点图层属性
             * @property gridOptions
             * @type {object}
             * @default
             */
            gridOptions:{
                visible:false,
                font:'14px Microsoft YaHei',
                color:'#222',
                stroke:'#fff',
                zooms:[3,18]
            },
            glRenderer: LW.glCanvas(),
            maskGeoJson:null
        },
        range:{
            min:NaN,
            max:NaN
        },
        initialize:function(gridModel,options){
            L.setOptions(this,options);
            this.resetMask(this.options.maskGeoJson);
            this.gridModel = gridModel;
            // this.setLegendData(this.options.legendData);

            var self = this;
            this.gridModel.on('transform',function(){
                self._update();
            });
        },

        resetMask:function(maskGeoJson){
            this.options.renderer.resetMask(maskGeoJson);
            this.options.glRenderer.resetMask(maskGeoJson);
        },

        _initGL:function(){
            if(!this.gl){
                var gl = this.gl = this._glRenderer.gl;

                var vsBuffer = this.vsBuffer = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, vsBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);

                this.prgObj = glUtil.getPrgObj(gl,this.getVs(),this.getFs());

                this.setLegendData(this.options.legendData);
            }
        },

        beforeAdd: function (map) {
            this._map = map;
            this._glRenderer = this.options.glRenderer;// glRenderer
            // Tip:需要在beforeAdd添加在map上，否则缩放会有问题
            if (this._glRenderer && !this._map.hasLayer(this._glRenderer))
                this._map.addLayer(this._glRenderer);
            this._renderer = map.getRenderer(this);// gridRenderer
            this._initGL();
        },

        onRemove: function () {
            LW.CanvasLayer.prototype.onRemove.call(this);
            if (this._glRenderer && this._map.hasLayer(this._glRenderer))
                this._map.removeLayer(this._glRenderer);
        },

        getVs: function() {
            return `attribute vec2 aPos;
                varying vec2 vPos;
                void main() {
                    gl_Position = vec4(aPos,0.0,1.0);
                    vPos = aPos * 0.5 + 0.5;
                }`;
        },

        getFs: function(){
            return `precision highp float;uniform vec4 uDataBounds;uniform float uRes;uniform sampler2D sDataTex;uniform sampler2D sColorTex;uniform vec3 uColorMinMax;uniform highp int uEPSG;uniform float uPxRes;uniform vec4 uBounds;varying vec2 vPos;uniform vec2 uMinMax;void main(){vec2 a;a=(uDataBounds.zw-uDataBounds.xy);vec2 b;b=((vPos*(uBounds.zw-uBounds.xy))+uBounds.xy);vec2 c;if((uEPSG==3857)){float d;d=exp((b.y/(57.29578*uPxRes)));float e;e=(min(abs(d),1.0)/max(abs(d),1.0));float f;f=(e*e);f=(((((((((((-0.01213232*f)+0.05368138)*f)-0.1173503)*f)+0.1938925)*f)-0.3326756)*f)+0.9999793)*e);f=(f+(float((abs(d)>1.0))*((f*-2.0)+1.570796)));vec2 g;g.x=(b.x/uPxRes);g.y=((((f*sign(d))*360.0)/3.141593)-90.0);c=g;}else{c=(b/uPxRes);}vec2 h;h=(c-uDataBounds.xy);if(((((h.x<0.0)||(h.y<0.0))||(h.x>a.x))||(h.y>a.y))){gl_FragColor=vec4(0.0,0.0,0.0,0.0);}else{vec2 i;vec2 j;vec2 k;vec2 l;vec2 m;vec2 n;vec2 o;vec2 p;p=fract((h/vec2(uRes)));vec2 q;q=(h+(-(p)*vec2(uRes)));vec2 r;r.x=((1.0-p.x)*uRes);r.y=(-(p.y)*uRes);vec2 s;s=(h+r);vec2 t;t.y=0.0;t.x=uRes;vec2 u;u=(q-t);vec2 v;v.y=0.0;v.x=uRes;vec2 w;w=(s+v);vec2 x;x.x=(-(p.x)*uRes);x.y=((1.0-p.y)*uRes);vec2 y;y=(h+x);vec2 z;z=(h+((vec2(1.0,1.0)-p)*vec2(uRes)));vec2 A;A.y=0.0;A.x=uRes;vec2 B;B=(y-A);vec2 C;C.y=0.0;C.x=uRes;vec2 D;D=(z+C);vec2 E;E.x=0.0;E.y=uRes;vec2 F;F.x=0.0;F.y=uRes;o=(q-F);vec2 G;G.x=0.0;G.y=uRes;n=(s-G);vec2 H;H.x=0.0;H.y=uRes;m=(w-H);vec2 I;I.x=0.0;I.y=uRes;l=(B+I);vec2 J;J.x=0.0;J.y=uRes;k=(y+J);vec2 K;K.x=0.0;K.y=uRes;j=(z+K);vec2 L;L.x=0.0;L.y=uRes;i=(D+L);vec2 M;M=((u-E)/a);lowp float N;if(((((M.x<0.0)||(M.y<0.0))||(M.x>=1.0))||(M.y>=1.0))){N=32767.0;}else{lowp vec4 O;O=(texture2D(sDataTex,M)*15.0);lowp float P;lowp float Q;Q=((((4096.0*O.x)+(256.0*O.y))+(O.z*16.0))+O.w);if((Q<32768.0)){P=Q;}else{P=(Q-65536.0);}N=P;}vec2 R;R=(o/a);lowp float S;if(((((R.x<0.0)||(R.y<0.0))||(R.x>=1.0))||(R.y>=1.0))){S=32767.0;}else{lowp vec4 T;T=(texture2D(sDataTex,R)*15.0);lowp float U;lowp float V;V=((((4096.0*T.x)+(256.0*T.y))+(T.z*16.0))+T.w);if((V<32768.0)){U=V;}else{U=(V-65536.0);}S=U;}vec2 W;W=(n/a);lowp float X;if(((((W.x<0.0)||(W.y<0.0))||(W.x>=1.0))||(W.y>=1.0))){X=32767.0;}else{lowp vec4 Y;Y=(texture2D(sDataTex,W)*15.0);lowp float Z;lowp float ba;ba=((((4096.0*Y.x)+(256.0*Y.y))+(Y.z*16.0))+Y.w);if((ba<32768.0)){Z=ba;}else{Z=(ba-65536.0);}X=Z;}vec2 bb;bb=(m/a);lowp float bc;if(((((bb.x<0.0)||(bb.y<0.0))||(bb.x>=1.0))||(bb.y>=1.0))){bc=32767.0;}else{lowp vec4 bd;bd=(texture2D(sDataTex,bb)*15.0);lowp float be;lowp float bf;bf=((((4096.0*bd.x)+(256.0*bd.y))+(bd.z*16.0))+bd.w);if((bf<32768.0)){be=bf;}else{be=(bf-65536.0);}bc=be;}lowp float bg;if(((((N>32000.0)||(S>32000.0))||(X>32000.0))||(bc>32000.0))){bg=32767.0;}else{bg=((((((((((-(N)*0.5)+(1.5*S))-(1.5*X))+(bc*0.5))*p.x)*p.x)*p.x)+(((((N-(2.5*S))+(2.0*X))-(bc*0.5))*p.x)*p.x))+(((-(N)*0.5)+(X*0.5))*p.x))+S);}vec2 bh;bh=(u/a);lowp float bi;if(((((bh.x<0.0)||(bh.y<0.0))||(bh.x>=1.0))||(bh.y>=1.0))){bi=32767.0;}else{lowp vec4 bj;bj=(texture2D(sDataTex,bh)*15.0);lowp float bk;lowp float bl;bl=((((4096.0*bj.x)+(256.0*bj.y))+(bj.z*16.0))+bj.w);if((bl<32768.0)){bk=bl;}else{bk=(bl-65536.0);}bi=bk;}vec2 bm;bm=(q/a);lowp float bn;if(((((bm.x<0.0)||(bm.y<0.0))||(bm.x>=1.0))||(bm.y>=1.0))){bn=32767.0;}else{lowp vec4 bo;bo=(texture2D(sDataTex,bm)*15.0);lowp float bp;lowp float bq;bq=((((4096.0*bo.x)+(256.0*bo.y))+(bo.z*16.0))+bo.w);if((bq<32768.0)){bp=bq;}else{bp=(bq-65536.0);}bn=bp;}vec2 br;br=(s/a);lowp float bs;if(((((br.x<0.0)||(br.y<0.0))||(br.x>=1.0))||(br.y>=1.0))){bs=32767.0;}else{lowp vec4 bt;bt=(texture2D(sDataTex,br)*15.0);lowp float bu;lowp float bv;bv=((((4096.0*bt.x)+(256.0*bt.y))+(bt.z*16.0))+bt.w);if((bv<32768.0)){bu=bv;}else{bu=(bv-65536.0);}bs=bu;}vec2 bw;bw=(w/a);lowp float bx;if(((((bw.x<0.0)||(bw.y<0.0))||(bw.x>=1.0))||(bw.y>=1.0))){bx=32767.0;}else{lowp vec4 by;by=(texture2D(sDataTex,bw)*15.0);lowp float bz;lowp float bA;bA=((((4096.0*by.x)+(256.0*by.y))+(by.z*16.0))+by.w);if((bA<32768.0)){bz=bA;}else{bz=(bA-65536.0);}bx=bz;}lowp float bB;if(((((bi>32000.0)||(bn>32000.0))||(bs>32000.0))||(bx>32000.0))){bB=32767.0;}else{bB=((((((((((-(bi)*0.5)+(1.5*bn))-(1.5*bs))+(bx*0.5))*p.x)*p.x)*p.x)+(((((bi-(2.5*bn))+(2.0*bs))-(bx*0.5))*p.x)*p.x))+(((-(bi)*0.5)+(bs*0.5))*p.x))+bn);}vec2 bC;bC=(B/a);lowp float bD;if(((((bC.x<0.0)||(bC.y<0.0))||(bC.x>=1.0))||(bC.y>=1.0))){bD=32767.0;}else{lowp vec4 bE;bE=(texture2D(sDataTex,bC)*15.0);lowp float bF;lowp float bG;bG=((((4096.0*bE.x)+(256.0*bE.y))+(bE.z*16.0))+bE.w);if((bG<32768.0)){bF=bG;}else{bF=(bG-65536.0);}bD=bF;}vec2 bH;bH=(y/a);lowp float bI;if(((((bH.x<0.0)||(bH.y<0.0))||(bH.x>=1.0))||(bH.y>=1.0))){bI=32767.0;}else{lowp vec4 bJ;bJ=(texture2D(sDataTex,bH)*15.0);lowp float bK;lowp float bL;bL=((((4096.0*bJ.x)+(256.0*bJ.y))+(bJ.z*16.0))+bJ.w);if((bL<32768.0)){bK=bL;}else{bK=(bL-65536.0);}bI=bK;}vec2 bM;bM=(z/a);lowp float bN;if(((((bM.x<0.0)||(bM.y<0.0))||(bM.x>=1.0))||(bM.y>=1.0))){bN=32767.0;}else{lowp vec4 bO;bO=(texture2D(sDataTex,bM)*15.0);lowp float bP;lowp float bQ;bQ=((((4096.0*bO.x)+(256.0*bO.y))+(bO.z*16.0))+bO.w);if((bQ<32768.0)){bP=bQ;}else{bP=(bQ-65536.0);}bN=bP;}vec2 bR;bR=(D/a);lowp float bS;if(((((bR.x<0.0)||(bR.y<0.0))||(bR.x>=1.0))||(bR.y>=1.0))){bS=32767.0;}else{lowp vec4 bT;bT=(texture2D(sDataTex,bR)*15.0);lowp float bU;lowp float bV;bV=((((4096.0*bT.x)+(256.0*bT.y))+(bT.z*16.0))+bT.w);if((bV<32768.0)){bU=bV;}else{bU=(bV-65536.0);}bS=bU;}lowp float bW;if(((((bD>32000.0)||(bI>32000.0))||(bN>32000.0))||(bS>32000.0))){bW=32767.0;}else{bW=((((((((((-(bD)*0.5)+(1.5*bI))-(1.5*bN))+(bS*0.5))*p.x)*p.x)*p.x)+(((((bD-(2.5*bI))+(2.0*bN))-(bS*0.5))*p.x)*p.x))+(((-(bD)*0.5)+(bN*0.5))*p.x))+bI);}vec2 bX;bX=(l/a);lowp float bY;if(((((bX.x<0.0)||(bX.y<0.0))||(bX.x>=1.0))||(bX.y>=1.0))){bY=32767.0;}else{lowp vec4 bZ;bZ=(texture2D(sDataTex,bX)*15.0);lowp float ca;lowp float cb;cb=((((4096.0*bZ.x)+(256.0*bZ.y))+(bZ.z*16.0))+bZ.w);if((cb<32768.0)){ca=cb;}else{ca=(cb-65536.0);}bY=ca;}vec2 cc;cc=(k/a);lowp float cd;if(((((cc.x<0.0)||(cc.y<0.0))||(cc.x>=1.0))||(cc.y>=1.0))){cd=32767.0;}else{lowp vec4 ce;ce=(texture2D(sDataTex,cc)*15.0);lowp float cf;lowp float cg;cg=((((4096.0*ce.x)+(256.0*ce.y))+(ce.z*16.0))+ce.w);if((cg<32768.0)){cf=cg;}else{cf=(cg-65536.0);}cd=cf;}vec2 ch;ch=(j/a);lowp float ci;if(((((ch.x<0.0)||(ch.y<0.0))||(ch.x>=1.0))||(ch.y>=1.0))){ci=32767.0;}else{lowp vec4 cj;cj=(texture2D(sDataTex,ch)*15.0);lowp float ck;lowp float cl;cl=((((4096.0*cj.x)+(256.0*cj.y))+(cj.z*16.0))+cj.w);if((cl<32768.0)){ck=cl;}else{ck=(cl-65536.0);}ci=ck;}vec2 cm;cm=(i/a);lowp float cn;if(((((cm.x<0.0)||(cm.y<0.0))||(cm.x>=1.0))||(cm.y>=1.0))){cn=32767.0;}else{lowp vec4 co;co=(texture2D(sDataTex,cm)*15.0);lowp float cp;lowp float cq;cq=((((4096.0*co.x)+(256.0*co.y))+(co.z*16.0))+co.w);if((cq<32768.0)){cp=cq;}else{cp=(cq-65536.0);}cn=cp;}lowp float cr;if(((((bY>32000.0)||(cd>32000.0))||(ci>32000.0))||(cn>32000.0))){cr=32767.0;}else{cr=((((((((((-(bY)*0.5)+(1.5*cd))-(1.5*ci))+(cn*0.5))*p.x)*p.x)*p.x)+(((((bY-(2.5*cd))+(2.0*ci))-(cn*0.5))*p.x)*p.x))+(((-(bY)*0.5)+(ci*0.5))*p.x))+cd);}lowp float cs;if(((((bg>32000.0)||(bB>32000.0))||(bW>32000.0))||(cr>32000.0))){cs=32767.0;}else{cs=((((((((((-(bg)*0.5)+(1.5*bB))-(1.5*bW))+(cr*0.5))*p.y)*p.y)*p.y)+(((((bg-(2.5*bB))+(2.0*bW))-(cr*0.5))*p.y)*p.y))+(((-(bg)*0.5)+(bW*0.5))*p.y))+bB);}lowp float ct;ct=(cs/10.0);mediump vec4 cu;if(((ct>=uMinMax.x)&&(ct<=uMinMax.y))){mediump vec4 cv;lowp vec4 cw;bool cx;if((cs>32766.0)){cx=bool(1);}else{cx=bool(0);}if(cx){cw=vec4(0.0,0.0,0.0,0.0);}else{lowp vec2 cy;cy.y=0.5;cy.x=(((cs/10.0)-uColorMinMax.x)/uColorMinMax.z);cw=texture2D(sColorTex,cy);}cv=cw;cu=cv;}else{cu=vec4(0.0,0.0,0.0,0.0);}gl_FragColor=cu;}}`
        },

        /**
         * 设置图例数据
         * @method setLegendData
         * @param legendData
         */
        setLegendData: function (legendData,steps) {
            var segments = Sun.Util.LegendData.getColorSegments(legendData,1,this.options.opacity);
            var legend = this.legend = new gradient(steps||2048,segments);
            if (legend && this.gl){
                legend.getColor();
                this.colorTex = glUtil.bindTexture(this.gl, this.gl.NEAREST, legend.colors, legend.steps, 1);
            }
        },

        /**
         * 设置数据
         * @method setData
         * @param data {ArrayBuffer|json} 数据，可为nc流数据或者json数据
         */
        setData: function (data) {
            if((data instanceof ArrayBuffer && data.byteLength>0))
                this.gridModel.setData(data);
            else
                this.clear();
        },

        /**
         * 设置网格显隐
         * @param visible
         */
        setGridVisible:function(visible){
            this.options.gridOptions.visible = visible;
            this._drawGrid();
        },

        /**
         * 展示所有范围的值，用于setDataRange后恢复
         * @method showAllRange
         */
        showAllRange:function () {
            this.setDataRange({min:NaN,max:NaN});
        },

        /**
         * 设置数据展示区间
         * @method setDataRange
         * @param range {object} {min:NaN,max:NaN}
         */
        setDataRange:function (range) {
            this.range=range;
            this._update();
        },

        clear:function(){
            this.gridModel.data = null;
            if(this.gl){
                this.gl.clearColor(0, 0, 0, 0);
                this.gl.clear(this.gl.COLOR_BUFFER_BIT);
            }
            LW.CanvasLayer.prototype.clear.call(this);
        },

        _update: function () {
            if (this.gridModel.data && this._map) {
                // var d1 = Date.now();
                this._draw();
                // var d2 = Date.now();
                // console.log('gradient update',(d2-d1)/1000+'s');
            }
        },

        _draw : function () {
            // 绘制渐变图层
            this._render();
            // 绘制网格
            this._drawGrid();
            // this._glRenderer.setMask();
        },

        _render: function(){
            var map = this._map,crs = this._map.options.crs , zoom = this._map.getZoom(),render = this._glRenderer;
            var options = this.options,llBounds = render._latLngBounds;
            var gridModel = this.gridModel,data=gridModel.data,dataBounds = gridModel.bounds;
            var gl = this.gl,prgObj = this.prgObj,range = this.range,mask = !!this.options.maskGeoJson;
            if(gl){
                var pxBounds = L.bounds(crs.latLngToPoint(llBounds.getSouthWest(), zoom),
                    crs.latLngToPoint(llBounds.getNorthEast(), zoom));
                this.res = getRes();
                var pxRes = 1 / this.res;
                var bounds = L.bounds(transition.latlng2point(llBounds.getSouthWest(), pxRes), transition.latlng2point(llBounds.getNorthEast(), pxRes));
                var size = bounds.getSize(), b = L.Browser.retina ? 2 : 1;
                size._multiplyBy(b);

                gl.viewport(0, 0, size.x, size.y);

                if(mask)
                    render.setMask();

                gl.useProgram(prgObj.program);

                // Pass test if stencil value is 1
                if(mask){
                    gl.stencilFunc(gl.EQUAL, 1, 0xFF);
                    gl.stencilMask(0x00);
                    gl.colorMask(1, 1, 1, 1);
                }

                gl.bindBuffer(gl.ARRAY_BUFFER, this.vsBuffer);
                gl.enableVertexAttribArray(prgObj.aPos);
                gl.vertexAttribPointer(prgObj.aPos, 2, gl.FLOAT, false, 0, 0);

                // gl.clearColor(0, 0, 0, 0);
                gl.clear(gl.COLOR_BUFFER_BIT);

                gl.deleteTexture(this.mainTex);
                var m = data.GridType == 11 ? new Uint16Array(data.speed.buffer) : new Uint16Array(data.data.buffer);
                this.mainTex = glUtil.bindTexture(gl, gl.NEAREST, m, data.lonsize, data.latsize);
                glUtil.activeTexture(gl, this.mainTex, 0);
                gl.uniform1i(prgObj.sDataTex, 0);
                gl.uniform4f(prgObj.uDataBounds, dataBounds.getWest(), dataBounds.getSouth(), dataBounds.getEast(), dataBounds.getNorth());

                gl.uniform1f(prgObj.uRes, data.nlon);//经纬度分辨率，由于经纬度间隔约定一致，所以只用nlon,之后有不同情况再做处理
                gl.uniform1f(prgObj.uPxRes, pxRes);
                gl.uniform4f(prgObj.uBounds, bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y);
                gl.uniform1i(prgObj.uEPSG, crs.code.split(":")[1]);

                var colorTex = this.colorTex, legend = this.legend;
                glUtil.activeTexture(gl, colorTex, 1);
                gl.uniform1i(prgObj.sColorTex, 1);
                gl.uniform3f(prgObj.uColorMinMax, legend.min, legend.max, legend.max - legend.min);

                gl.uniform2f(prgObj.uMinMax, isNaN(range.min) ? -9997 : range.min, isNaN(range.max) ? 9997 : range.max);

                gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
            }

            function getRes() {
                return (llBounds.getEast() - llBounds.getWest()) / pxBounds.getSize().x;
            }
        },

        _drawGrid:function () {
            LW.CanvasLayer.prototype.clear.call(this);
            if(this.options.gridOptions.visible) {
                var map = this._map, options = this.options.gridOptions, zoom = map.getZoom();
                if (zoom >= options.zooms[0] && zoom <= options.zooms[1]) {
                    var render = this._renderer, ctx = render._ctx, llBounds = this._glRenderer._latLngBounds;
                    var gridModel = this.gridModel, data = gridModel.data, dataBounds = gridModel.bounds,
                        dataRes = data.nlon;
                    var range = this.range;

                    var x = 36;
                    var min = L.LatLng.div(llBounds.getSouthWest().offset(dataBounds.getSouthWest()), dataRes)._floor(),
                        max = L.LatLng.div(llBounds.getNorthEast().offset(dataBounds.getSouthWest()), dataRes)._ceil()
                    var res = this.res;
                    var gap = dataRes / res > x ? 1 : Math.ceil(x / (dataRes / res));
                    gap = getGap(gap);
                    min = L.LatLng.div(llBounds.getSouthWest(), dataRes * gap)._floor()._multiplyBy(gap)._subtract(L.LatLng.div(dataBounds.getSouthWest(), dataRes)._round())

                    for (var i = min.y; i <= max.y; i += gap) {
                        for (var j = min.x; j <= max.x; j += gap) {
                            var value = gridModel.getGrid(i, j);
                            if (isShowGrid(value)) {
                                var latlng = L.latLng(i * dataRes + dataBounds.getSouth(), j * dataRes + dataBounds.getWest());
                                var p = map.latLngToContainerPoint(latlng);
                                _drawValue(value, p);
                            }
                        }
                    }
                    render.setMask();
                }
            }

            function isShowGrid(value) {
                if(value){
                    if(isNaN(range.min) && isNaN(range.max))
                        return true;
                    else if(isNaN(range.min))
                        return value<=range.max;
                    else if(isNaN(range.max))
                        return value>=range.min;
                    else
                        return value>=range.min && value<=range.max;
                }
            }

            function getGap(g) {
                return 1 << Math.floor(Math.log(g + g - 1) / Math.LN2)
            }

            function _drawValue(value, p, yOffset) {
                if (!ctx) return;
                yOffset = yOffset || 5;
                ctx.font = options.font;
                ctx.textAlign = "center";
                if (options.stroke) {
                    ctx.strokeStyle = options.stroke;
                    ctx.lineWidth = 2;
                    ctx.strokeText(value, p.x, p.y + yOffset);
                }
                ctx.fillStyle = options.color;
                ctx.fillText(value, p.x, p.y + yOffset);
            }
        }
    });

    /**
     * @class LW.GradientGlLayer
     * @constructor
     * @param gridModel {LW.GridModel|LW.GridModelManager} 格点数据模型
     * @param options {object} 外部属性，可重设Properties
     * @returns {LW.GradientGlLayer}
     */
    LW.gradientGlLayer = function (gridModel,options) {
        return new LW.GradientGlLayer(gridModel,options);
    };
})();

/**
 * 台风图层
 * @module Layer.Typ
 */
/**
 * 台风组合
 *
 * Features :
 *      1. 管理多个台风图层的Group
 *
 * Update Note：
 *      + v1.3.0-dev ：Created
 *
 * @class LW.TypGroup
 * @extends L.FeatureGroup
 * @demo demo/plot/typ.html  {台风}
 */
LW.TypGroup = L.FeatureGroup.extend({
    options:{
        pane:'typPane',
        /**
         * 是否展示警戒线
         * @property showAlmtLine
         * @type {Boolean}
         * @default true
         */
        showAlmtLine:true,
        /**
         * 警戒线颜色，分24小时警戒线和48小时警戒线
         * @property almtLineColor
         * @type {Object}
         * @default {'24':'#f00','48':'#ff7e00'}
         */
        almtLineColor:{'24':'#f00','48':'#ff7e00'},
        almtLineLabelOpts:{edge: false,bold: true,iconSize: L.point(10, 50),iconAnchor: L.point(-10,0)}
    },

    initialize:function (options) {
        this.typhoons={};
        L.setOptions(this,options);
        L.FeatureGroup.prototype.initialize.call(this,options);
        if(this.options.showAlmtLine)
            this._createAlmtLine();
    },

    /**
     * 添加台风
     * @method addTyphoon
     * @param typData {array|object} 台风数据
     * @param isPlay {boolean} 是否播放
     */
    addTyphoon:function (typData,isPlay) {
        var self = this;
        if(Sun.Util.isArray(typData)){
            typData.forEach(function (item) {
                self.addTyphoon(item,isPlay);
            })
        }
        else{
            var layer = this.typhoons[typData.ID] || LW.typLayer(this.options);
            layer.setForeStations(this.foreStations);
            if(!this.hasLayer(layer)) this.addLayer(layer);
            layer.setData(typData,isPlay);
            this.typhoons[typData.ID] = layer;
        }
    },

    /**
     * 设置台风显隐
     * @method setTyphoonVisible
     * @param id
     * @param visible
     */
    setTyphoonVisible:function (id,visible) {
        var layer = this.typhoons[id];
        if(layer && this.hasLayer(layer) && !visible)
            this.removeLayer(layer);
        else if(layer && !this.hasLayer(layer) && visible)
            this.addLayer(layer);
    },
    /**
     * 删除台风
     * @method deleteTyphoon
     * @param id
     */
    deleteTyphoon:function (id) {
        this.setTyphoonVisible(id,false);
        delete this.typhoons[id];
    },

    /**
     * 根据id获取台风
     * @method getTyphoon
     * @param id
     * @returns {LW.TypLayer}
     */
    getTyphoon: function (id) {
        return this.typhoons[id];
    },

    /**
     * 遍历所有台风
     * @method eachTyphoon
     * @param method
     * @param context
     * @param id
     * @return {LW.TypGroup}
     */
    eachTyphoon: function (method, context,id) {
        if(this.typhoons[id] && this.hasLayer(this.typhoons[id]))
            method.call(context, this.typhoons[id]);
        for (var i in this.typhoons) {
            if(this.hasLayer(this.typhoons[i]))
                method.call(context, this.typhoons[i]);
        }
        return this;
    },

    /**
     * 设置台风预报站点
     * @method setForeStations
     * @param foreStations {Array} eg：["广州","上海","香港","福州","杭州","台湾","关岛","韩国","日本"]
     * @param [id] {String} 只针对传入id对应的台风生效
     */
    setForeStations:function (foreStations,id) {
        this.foreStations = foreStations;
        this.eachTyphoon(function (layer) {
            layer.setForeStations(foreStations);
        },this,id);
    },

    /**
     * 设置预报路径显隐
     * @method setForePathVisible
     * @param visible {Boolean}
     * @param [id] {String} 只针对传入id对应的台风生效
     */
    setForePathVisible:function (visible,id) {
        this.eachTyphoon(function (layer) {
            layer.setForePathVisible(visible);
        },this,id);
    },

    /**
     * 设置风圈显影
     * @method setWindCircleVisble
     * @param visible {Boolean}
     * @param [id] {String} 只针对传入id对应的台风生效
     */
    setWindCircleVisble:function (visible,id) {
        this.eachTyphoon(function (layer) {
            layer.setWindCircleVisble(visible);
        },this,id);
    },

    /**
     * 设置台风名Tooltip的显隐
     * @method setTooltipVisible
     * @param visible
     * @param id
     */
    setTooltipVisible:function (visible,id) {
        this.eachTyphoon(function (layer) {
            layer.setTooltipVisible(visible);
        },this,id);
    },

    onAdd: function (map) {
        map.addLayer(this.almtline);
        L.FeatureGroup.prototype.onAdd.call(this, map);
    },

    onRemove: function (map) {
        map.removeLayer(this.almtline);
        L.FeatureGroup.prototype.onRemove.call(this, map);
    },

    _createAlmtLine:function () {
        this.almtline=L.featureGroup();
        var almtColor = this.options.almtLineColor;
        var labelOpts = this.options.almtLineLabelOpts;

        var latlng_24 = [[0,105],[4.5,113],[11,119],[18,119],[22,127],[34,127]];
        var latlng_48 = [[0,105],[0, 120],[15,132],[34,132]];
        L.polyline(latlng_24, {color: almtColor['24'],weight:2,dashArray:'5,5'}).addTo(this.almtline);
        labelOpts.color = almtColor['24'];
        var labelLayer1 = LW.labelLayer({minZoom: 5,iconOptions:labelOpts}).addTo(this.almtline);
        labelLayer1.setData([{"NAME":"24小时警戒线","LOCATION":[[127,30]]}]);

        L.polyline(latlng_48, {color: almtColor['48'],weight:2,dashArray:'5,5'}).addTo(this.almtline);
        labelOpts = Sun.Util.Data.deepClone(labelOpts);
        labelOpts.color = almtColor['48'];
        var labelLayer2 = LW.labelLayer({minZoom: 5,iconOptions:labelOpts}).addTo(this.almtline);
        labelLayer2.setData([{"NAME":"48小时警戒线","LOCATION":[[132,30]]}]);
    },

    /**
     * 设置警戒线的显隐
     * @method setAlmtLineVisible
     * @param visible
     */
    setAlmtLineVisible:function (visible) {
        if(this.almtline)
            visible?this._map.addLayer(this.almtline):this._map.removeLayer(this.almtline);
    }
});

/**
 * 台风图层
 *
 * Features :
 *      1. 当前台风路径,预报路径
 *      2. 每个台风点的台风预报路径和台风七级、十级风圈
 *      3. 设置buffer展示
 *      4. editData结构：{
 *                          actualItem, // 当前选择的实况点
 *                          forecast:{  // 预报数据，包含预报点，预报点热点，预报风圈半径，预报路径path
 *                              key1:{markers:[],hots:[],radius:[],line},
 *                              key2:{markers:[],hots:[],radius:[],line},
 *                              ..
 *                          }
 *                       }
 *
 * Update Note：
 *      + v1.3.0-dev ：Created
 *      + v1.5.1 ：1. 实况台风的类型由current改为actual
 *                 2. 增加影响范围及台风编辑的支持
 *                 3. 增加台风播放
 *                 4. 增加showEveryForecast属性，配置是否展示预报台过时的最近预报，在台风编辑时此属性最好为false
 *
 * @class LW.TypLayer
 * @extends L.FeatureGroup
 * @demo demo/plot/typ.html  {台风}
 */
LW.TypLayer = L.FeatureGroup.extend({
    options:{
        /**
         * 台风等级图例
         * @property levelLegend
         * @type {Array}
         * @default Sun.LegendData.typ.current
         */
        levelLegend:Sun.LegendData.typ.current,
        /**
         * 台风预报路径图例
         * @property forecastLegend
         * @type {Array}
         * @default Sun.LegendData.typ.forecast
         */
        forecastLegend:Sun.LegendData.typ.forecast,
        renderer:L.canvas({pane:'typPane'}),
        underRenderer:L.svg({pane:'shadowPane'}),
        playInterval:100,
        /**
         * 当前台风的icon的样式调整options
         * @property iconOptions
         * @type {Object}
         * @default { radius:5, stroke:false, fillOpacity:1, pane:'typPane' }
         */
        iconOptions:{
            radius:5,
            stroke:false,
            fillOpacity:1,
            pane:'typPane'
        },
        /**
         * 当前台风的icon的样式调整options
         * @property foreIconOptions
         * @type {Object}
         * @default { radius:5, stroke:true, weight:1, color:'#656565', fillOpacity:1, pane:'typPane' }
         */
        foreIconOptions:{
            radius:5,
            stroke:true,
            weight:1,
            color:'#656565',
            fillOpacity:1,
            pane:'typPane',
            zIndexOffset:500
        },
        /**
         * 热点的样式调整options
         * @property hotOptions
         * @type {Object}
         * @default { radius:10, stroke:false, pane:'typPane' }
         */
        hotOptions:{
            radius:10,
            stroke:false,
            pane:'typPane',
            zIndexOffset:500
        },
        /**
         * 风圈的样式
         * @property windCircle
         * @type {Object}
         * @default { weight:2, color:'#fff992', fillColor:'#ff9000', fillOpacity:0.4 }
         */
        windCircle:{
            weight:2,
            color:'#fff992',
            fillColor:'#ff9000',
            fillOpacity:0.4,
            renderer:L.canvas({pane:'typPane'})
        },
        /**
         * 最新台风详细框的样式
         * @property windCircle
         * @type {Object}
         * @default { weight:2, color:'#fff992', fillColor:'#ff9000', fillOpacity:0.4 }
         */
        toolTipOptions:{
            direction:'right',
            className:'lw-typ-tooltip',
            offset:L.point(15,0),
            permanent:true
        },
        /**
         * 路径时间文本是否展示
         * @property listTimeVisible
         * @type {Boolean}
         * @default true
         */
        listTimeVisible:true,
        /**
         * 路径时间文本的展示等级
         * @property listTimeShowZoom
         * @type {int}
         * @default 9
         */
        listTimeShowZoom:9,
        /**
         * 路径时间文本的样式，默认的样式在
         * @property listTimeShowZoom
         * @type {Object}
         * @default {className:'lw-typ-tooltip-list',permanent:true}
         */
        listTimeOptions:{
            className:'lw-typ-tooltip-list',
            permanent:true
        },

        /**
         * 是否展示影响范围
         * @property showAffectRange
         * @type {Boolean}
         * @default false
         */
        showAffectRange:false,

        /**
         * 展示影响范围的key,即展示那个预报路径的影响范围
         * @property affectRangeKey
         * @type {String}
         * @default '北京'
         */
        affectRangeKey:'北京',
        /**
         * 影响范围的首个圈的半径
         * @property firstRadius
         * @type {int}
         * @default 0
         */
        firstRadius:0,
        /**
         * 影响范围的默认半径间隔
         * @property radiusGap
         * @type {int}
         * @default 30
         */
        radiusGap:30,
        /**
         * 影响范围的样式，geojson的样式配置
         * @property affectRangeStyle
         * @type {Object}
         */
        affectRangeStyle:{
            weight:1,
            color:'#ffc366',
            smoothFactor:0.01,
            noClip:true
        },
        /**
         * 是否展示预报台过时的最近预报，在台风编辑时此属性最好为false
         * @property showEveryForecast
         * @type {boolean}
         */
        showEveryForecast:true
    },

    initialize:function (options) {
        L.setOptions(this,options);
        L.FeatureGroup.prototype.initialize.call(this,options);
        this.actualTyp = L.featureGroup();
        this.forecastTyp = L.featureGroup();
        this.affectRange = L.geoJson(null,this.options.affectRangeStyle);
        // this.options.windCircle.renderer = this.options.renderer;//Tip:共用一个renderer，多个台风，风圈出现有的实线有的虚线的情况
        this.quadCircle7 = LW.quadCircle([0,0],this.options.windCircle);
        this.quadCircle10 = LW.quadCircle([0,0],this.options.windCircle);

        var icon = L.icon({
            iconUrl: LW.defaultIconPath()+'typ.gif',
            iconSize: [30, 30],
            zIndexOffset:1000
        });
        this.typGif = L.marker([0,0], {icon: icon,interactive:false,pane:'typPane',zIndexOffset:1000})
            .bindTooltip('',this.options.toolTipOptions);

        this.affectRadius={};
    },

    onAdd: function (map) {
        map.addLayer(this.quadCircle7);
        map.addLayer(this.quadCircle10);
        map.addLayer(this.forecastTyp);
        map.addLayer(this.affectRange);
        map.addLayer(this.actualTyp);
        map.addLayer(this.typGif);
        map.on('zoomend',this._zoomend, this);
        L.LayerGroup.prototype.onAdd.call(this, map);
        this._zoomend();
    },

    onRemove: function (map) {
        map.removeLayer(this.quadCircle7);
        map.removeLayer(this.quadCircle10);
        map.removeLayer(this.actualTyp);
        map.removeLayer(this.forecastTyp);
        map.removeLayer(this.affectRange);
        map.removeLayer(this.typGif);
        map.off('zoomend',this._zoomend, this);
        L.LayerGroup.prototype.onRemove.call(this, map);
    },

    _zoomend:function () {
        if(this._map){
            var zoom = this._map.getZoom(),showZoom = this.options.listTimeShowZoom;
            if(this.options.listTimeVisible && this.actualTypList){
                this.actualTypList.forEach(function (m) {
                    zoom<showZoom ?m.closeTooltip() : m.openTooltip();
                })
            }
        }
    },

    /**
     * 设置预报路径显影
     * @method setForePathVisible
     * @param visible
     */
    setForePathVisible:function (visible) {
        visible?this._map.addLayer(this.forecastTyp):this._map.removeLayer(this.forecastTyp);
    },

    /**
     * 设置风圈显影
     * @method setWindCircleVisble
     * @param visible
     */
    setWindCircleVisble:function (visible) {
        visible?this._map.addLayer(this.quadCircle7):this._map.removeLayer(this.quadCircle7);
        visible?this._map.addLayer(this.quadCircle10):this._map.removeLayer(this.quadCircle10);
    },

    /**
     * 设置最新台风详细框显隐
     * @method setTooltipVisible
     * @param visible
     */
    setTooltipVisible:function (visible) {
        visible?this.typGif.openTooltip():this.typGif.closeTooltip();
    },

    /**
     * 设置台风数据
     * @method setData
     * @param data
     * @param isPlay 是否播放
     * @returns {LW.TypLayer}
     */
    setData:function (data,isPlay) {
        this.data = data;
        this.bounds = L.latLngBounds();

        this.clearLayers();
        // 展示实况路径详细
        isPlay ? this._playActualTyp(data.DETAIL,data.NAME):this._setActualTyp(data.DETAIL,data.NAME);
        return this;
    },

    /**
     * 获取当前台风边界
     * @method getBounds
     * @param latlng
     * @returns {L.LatLngBounds}
     */
    getBounds:function (latlng) {
        if(latlng)
            this.bounds.extend(latlng);
        return this.bounds;
    },

    // 展示台风gif
    _setTypGif:function(detail,name){
        var detail0 = detail[0];
        var latlng = [detail0.LATITUDE,detail0.LONGITUDE];
        var date = new Date(detail0.HAPPENTIME.replace(/-/g, '/'));
        this.typGif.setLatLng(latlng)
            .setTooltipContent(name + ' '+ date.format('MM月dd日 hh时')).openTooltip();
    },

    // 播放实况台风路径
    _playActualTyp:function(detail,name){
        this.actualTyp.clearLayers();
        this.actualTypList = [];
        var self = this,i = detail.length-1;
        var item1 = detail[0],item2 = detail[i];
        var latlngBounds = L.latLngBounds([[item1["LATITUDE"], item1["LONGITUDE"]],[item2["LATITUDE"], item2["LONGITUDE"]]]);
        this._map.fitBounds(latlngBounds);
        var interval = setInterval(function () {
            if(i>=0){
                self._setActualItem(detail[i],i>0?detail[i-1]:null,true);
                i--;
            }
            else{
                clearInterval(interval);
                self._setTypGif(detail,name);
            }
        },this.options.playInterval);
        this._zoomend();
    },

    // 设置实况台风路径
    _setActualTyp:function (detail,name) {
        this.actualTyp.clearLayers();
        this.actualTypList = [];
        for(var i=0;i<detail.length;i++){
            this._setActualItem(detail[i],i>0?detail[i-1]:null,i==0);
        }
        this._setTypGif(detail,name);
        this._zoomend();
    },

    // 设置实况台风路径item
    _setActualItem:function(item,item2,settingCurId){
        var self = this;

        var latlng = L.latLng(item["LATITUDE"], item["LONGITUDE"]);
        this.bounds.extend(latlng);

        var opts = this.options.iconOptions,hotOpts = this.options.hotOptions;
        opts.renderer = this.options.renderer;
        opts.fillColor=hotOpts.fillColor=this._getColor(item);

        var m = L.circleMarker(latlng, opts).addTo(self.actualTyp);
        // Tip:此处的closeTooltip并不能关闭Tooltip
        var date = new Date(item.HAPPENTIME.replace(/-/g, '/'));
        if(item2) m.bindTooltip(date.format('MM月dd日 hh时'),this.options.listTimeOptions)/*.closeTooltip()*/;
        this.actualTypList.push(m);
        var hot = L.circleMarker(latlng, hotOpts).addTo(this.actualTyp);
        hot.id = item.ID;
        hot.data = item;
        if(item2){// Tip: 两个点时才绘制实况路径
            var latlng2 = L.latLng(item2["LATITUDE"], item2["LONGITUDE"]);
            L.polyline([latlng,latlng2], {color: opts.fillColor,weight:1,renderer:this.options.renderer}).addTo(this.actualTyp);
        }
        if(settingCurId)// Tip: 是否设置id的相关其他展示，播放时依次设置，不播放时就最新点设置
            this.setCurID(item.ID,m,hot,!!item2);
        onClick(m,hot);

        function onClick(marker, hot) {
            hot.on("click", function (e) {
                e.originalEvent.stopPropagation();
                self.setCurID(e.target.id,marker,hot);
            });
        }
    },


    /**
     * 设置预报站点
     * @method setForeStations
     * @param foreStations
     */
    setForeStations:function (foreStations) {
        this.foreStations = foreStations;
        if(this.curID && this.curLatlng)
            this._setForecastTyp(this.curID,this.curLatlng);
    },

    _hasForeStation:function (station) {
        return this.foreStations&&this.foreStations.indexOf(station)!=-1;
    },

    // 设置预报路径
    _setForecastTyp:function (id,_latlng) {
        this.forecastTyp.clearLayers();
        var fDetail = this.data.FORECAST_DETAIL[id];
        var self = this;

        if(fDetail){
            for (var key in fDetail) {
                if(this._hasForeStation(key))
                    drawOneForePath(key,fDetail[key],this._getForecastColor(key));
            }
        }

        function drawOneForePath(key,data,color) {
            // Tip: 预报路径从当前点开始预报，或者属性为所有最近预报都展示才展示该预报路径
            if(self.options.showEveryForecast || data[0].TYPHOONDETAILID === id){
                var latlng0 = L.latLng(data[0].TYPHOONDETAILLAT,data[0].TYPHOONDETAILLON);
                var latlngs=[latlng0];
                var markers = [];
                var hots = [];
                data.forEach(function (item,index) {
                    var latlng = L.latLng(item["LATITUDE"], item["LONGITUDE"]);
                    latlngs.push(latlng);
                    var opts = self.options.foreIconOptions;
                    opts.fillColor=self._getColor(item);
                    var marker = L.circleMarker(latlng, opts).addTo(self.forecastTyp);
                    var hotOpts={radius:10,stroke:false,fillOpacity:0,pane:"typPane"};
                    var hot = L.circleMarker(latlng, hotOpts).addTo(self.forecastTyp);
                    hot.id = item.ID;
                    hot.index = index+1;
                    hot.key = key;
                    hot.data = item;
                    hot.on("click", function (e) {
                        e.originalEvent.stopPropagation();
                        self.setForeID(e.target.id,e.target.key,marker,hot);
                    });
                    markers.push(marker);
                    hots.push(hot);
                });
                var line = L.polyline(latlngs, {color: color,weight:1,dashArray:'5,5',renderer:self.options.renderer}).addTo(self.forecastTyp);
                self.editData.forecast[key]={markers:markers,hots:hots,line:line,labels:{}};
            }
        }
    },


    setCurID:function (id,marker,hot,play) {
        // 设置风圈
        var item = Sun.Util.Array.getItemByField(this.data.DETAIL,'ID',id);
        if(this.curID != id){
            this.curID = id;
            this.curLatlng = [item.LATITUDE,item.LONGITUDE];
            this.quadCircle7.setLatLng(this.curLatlng);
            this.quadCircle7.setRadius({NE:item.WINDRADIUS7NE*1000,NW:item.WINDRADIUS7NW*1000,
                SE:item.WINDRADIUS7SE*1000,SW:item.WINDRADIUS7SW*1000});

            var radius = item.WINDRADIUS10 ? {NE:item.WINDRADIUS10NE*1000,NW:item.WINDRADIUS10NW*1000,
                SE:item.WINDRADIUS10SE*1000,SW:item.WINDRADIUS10SW*1000} : {NE:0,NW:0,SE:0,SW:0};
            this.quadCircle10.setLatLng([item.LATITUDE,item.LONGITUDE]);
            this.quadCircle10.setRadius(radius);

            if(!play){
                this.editData = {actualItem:hot,forecast:{}};
                // 更新预报路径展示
                this._setForecastTyp(id,this.curLatlng);
                // 更新影响范围
                this.setAffectRange(id,this.curLatlng,true);
            }
        }

        if(!play)
            this.fire('click',{markerType:'actual',typID:this.data.ID,item:item,marker:marker,hot:hot},true);
    },

    setForeID:function (id,key,marker,hot) {
        var data = this.data.FORECAST_DETAIL[this.curID][key];
        var item = Sun.Util.Array.getItemByField(data,'ID',id);
        this.fire('click',{markerType:'forecast',typID:this.data.ID,item:item,marker:marker,hot:hot},true);
    },

    // 设置影响范围
    setAffectRange:function(id,_latlng,isNewRadius){
        var options = this.options;
        if(options.showAffectRange){
            var affectKey = options.affectRangeKey;
            var curForecastData = this.editData.forecast[affectKey];
            if(curForecastData){
                var data = curForecastData.line.getLatLngs();
                if(data && data.length>0) {
                    //Tip:radius第一个是实况的半径,通过索引定位指定的半径
                    var radius = curForecastData.radius;
                    if (isNewRadius) {
                        radius = [];
                        for (var i = 0, r = this.options.firstRadius; i < data.length; i++, r += this.options.radiusGap) {
                            radius.push(r);
                        }
                        curForecastData.radius = radius;
                    }
                    this.affectRange.clearLayers();

                    var union, p1, p2;
                    for (var i = 1; i < data.length; i++) {
                        p1 = [data[i - 1].lng, data[i - 1].lat];
                        p2 = [data[i].lng, data[i].lat];
                        var r1 = radius[i - 1], r2 = radius[i];
                        var d = data[i].distanceTo(data[i - 1])/1000;
                        if(r2-r1<d){//Tip: 若圆2包含圆1则无公切线，直接采用圆2作为影响范围的区域
                            if (i === 1) { // 实况点和第一个预报点
                                if (r1 === 0) {
                                    var tengents = Sun.Util.Geometry.tangent(p1, p2, r2);
                                    union = turf.polygon([[p1].concat(tengents).concat([p1])]);
                                }
                                else {
                                    var publicTengents = Sun.Util.Geometry.publicTangent(p1, r1, p2, r2);
                                    union = getUnion(publicTengents, p1, r1)
                                }
                            }
                            else {
                                var publicTengents = Sun.Util.Geometry.publicTangent(p1, r1, p2, r2);
                                union = turf.union(union, getUnion(publicTengents));
                            }
                        }
                        var circle2 = getUnion(null, p2, r2);
                        union = union ? turf.union(union,circle2) : circle2;
                    }
                    this.affectRange.addData(union);
                }
            }

            // 设置切点，并获取合并后的图形
            function getUnion(publicTengents,p,radius) {
                var _union;
                if(publicTengents){
                    var t1 = publicTengents[0].geometry.coordinates,t2 = publicTengents[1].geometry.coordinates;
                    tengents = [t1[1],t2[1]];
                    var coords = t1.concat(t2.reverse()).concat([t1[0]]);
                    _union = turf.polygon([coords]);
                }

                if(p && radius){
                    var circle = turf.circle(p, radius, 64, 'kilometers');
                    // self.affectRange.addData(circle);
                    _union = _union ? turf.union(circle, _union) : circle;
                }
                return _union;
            }
        }
    },

    /**
     * 设置buffer
     * @method setBuffer
     * @param start {string} 开始时间：2018-06-09 08:00:00
     * @param end {string} 结束时间：2018-06-10 20:00:00
     * @param radius {number} 半径，单位：公里
     */
    setBuffer:function (start,end,radius) {
        var i_start = Sun.Util.Array.getItemIndexByField(this.data.DETAIL,'HAPPENTIME',end);
        var i_end = Sun.Util.Array.getItemIndexByField(this.data.DETAIL,'HAPPENTIME',start);
        var data = this.data.DETAIL.slice(i_start,i_end+1);
        var line = data.map(function (item) {
            return [item.LONGITUDE,item.LATITUDE];
        });
        line = line.length>1?turf.lineString(line):turf.point(line[0]);
        var buffered = turf.buffer(line, radius, 'kilometers');
        var latlngs = buffered.geometry.coordinates[0].map(function (item) {
            return [item[1],item[0]];
        });
        if(!this.buffer)
            this.buffer = L.polygon(latlngs, {color:'#fff', fill:true, weight: 1,renderer:this.options.underRenderer});
        else
            this.buffer.setLatLngs(latlngs);
        if(!this.actualTyp.hasLayer(this.buffer))
            this.actualTyp.addLayer(this.buffer);
    },

    /**
     * 移除buffer
     * @method removeBuffer
     */
    removeBuffer:function () {
        if(this.buffer && this.actualTyp.hasLayer(this.buffer))
            this.actualTyp.removeLayer(this.buffer);
    },

    _getColor: function (item) {
        return Sun.Util.LegendData.getColor(this.options.levelLegend, item["TYPHOONTYPE"]);
    },

    _getForecastColor: function (station) {
        return Sun.Util.LegendData.getColor(this.options.forecastLegend, station);
    },
});
/**
 * @class LW.TypLayer
 * @constructor
 * @param options {object} 外部属性，可重设Properties
 * @returns {LW.TypLayer}
 */
LW.typLayer = function (options) {
    return new LW.TypLayer(options);
};

!function(t){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=t();else if("function"==typeof define&&define.amd)define([],t);else{("undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:this).rbush=t()}}(function(){return function t(i,n,e){function r(h,o){if(!n[h]){if(!i[h]){var s="function"==typeof require&&require;if(!o&&s)return s(h,!0);if(a)return a(h,!0);var f=new Error("Cannot find module '"+h+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[h]={exports:{}};i[h][0].call(l.exports,function(t){var n=i[h][1][t];return r(n||t)},l,l.exports,t,i,n,e)}return n[h].exports}for(var a="function"==typeof require&&require,h=0;h<e.length;h++)r(e[h]);return r}({1:[function(t,i,n){"use strict";function e(t,i){if(!(this instanceof e))return new e(t,i);this._maxEntries=Math.max(4,t||9),this._minEntries=Math.max(2,Math.ceil(.4*this._maxEntries)),i&&this._initFormat(i),this.clear()}function r(t,i){a(t,0,t.children.length,i,t)}function a(t,i,n,e,r){r||(r=m(null)),r.minX=1/0,r.minY=1/0,r.maxX=-1/0,r.maxY=-1/0;for(var a,o=i;o<n;o++)a=t.children[o],h(r,t.leaf?e(a):a);return r}function h(t,i){return t.minX=Math.min(t.minX,i.minX),t.minY=Math.min(t.minY,i.minY),t.maxX=Math.max(t.maxX,i.maxX),t.maxY=Math.max(t.maxY,i.maxY),t}function o(t,i){return t.minX-i.minX}function s(t,i){return t.minY-i.minY}function f(t){return(t.maxX-t.minX)*(t.maxY-t.minY)}function l(t){return t.maxX-t.minX+(t.maxY-t.minY)}function u(t,i){return t.minX<=i.minX&&t.minY<=i.minY&&i.maxX<=t.maxX&&i.maxY<=t.maxY}function c(t,i){return i.minX<=t.maxX&&i.minY<=t.maxY&&i.maxX>=t.minX&&i.maxY>=t.minY}function m(t){return{children:t,height:1,leaf:!0,minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0}}function d(t,i,n,e,r){for(var a,h=[i,n];h.length;)(n=h.pop())-(i=h.pop())<=e||(a=i+Math.ceil((n-i)/e/2)*e,x(t,a,i,n,r),h.push(i,a,a,n))}i.exports=e,i.exports.default=e;var x=t("quickselect");e.prototype={all:function(){return this._all(this.data,[])},search:function(t){var i=this.data,n=[],e=this.toBBox;if(!c(t,i))return n;for(var r,a,h,o,s=[];i;){for(r=0,a=i.children.length;r<a;r++)h=i.children[r],c(t,o=i.leaf?e(h):h)&&(i.leaf?n.push(h):u(t,o)?this._all(h,n):s.push(h));i=s.pop()}return n},collides:function(t){var i=this.data,n=this.toBBox;if(!c(t,i))return!1;for(var e,r,a,h,o=[];i;){for(e=0,r=i.children.length;e<r;e++)if(a=i.children[e],h=i.leaf?n(a):a,c(t,h)){if(i.leaf||u(t,h))return!0;o.push(a)}i=o.pop()}return!1},load:function(t){if(!t||!t.length)return this;if(t.length<this._minEntries){for(var i=0,n=t.length;i<n;i++)this.insert(t[i]);return this}var e=this._build(t.slice(),0,t.length-1,0);if(this.data.children.length)if(this.data.height===e.height)this._splitRoot(this.data,e);else{if(this.data.height<e.height){var r=this.data;this.data=e,e=r}this._insert(e,this.data.height-e.height-1,!0)}else this.data=e;return this},insert:function(t){return t&&this._insert(t,this.data.height-1),this},clear:function(){return this.data=m([]),this},remove:function(t,i){if(!t)return this;for(var n,e,r,a,h=this.data,o=this.toBBox(t),s=[],f=[];h||s.length;){if(h||(h=s.pop(),e=s[s.length-1],n=f.pop(),a=!0),h.leaf&&-1!==(r=function(t,i,n){if(!n)return i.indexOf(t);for(var e=0;e<i.length;e++)if(n(t,i[e]))return e;return-1}(t,h.children,i)))return h.children.splice(r,1),s.push(h),this._condense(s),this;a||h.leaf||!u(h,o)?e?(n++,h=e.children[n],a=!1):h=null:(s.push(h),f.push(n),n=0,e=h,h=h.children[0])}return this},toBBox:function(t){return t},compareMinX:o,compareMinY:s,toJSON:function(){return this.data},fromJSON:function(t){return this.data=t,this},_all:function(t,i){for(var n=[];t;)t.leaf?i.push.apply(i,t.children):n.push.apply(n,t.children),t=n.pop();return i},_build:function(t,i,n,e){var a,h=n-i+1,o=this._maxEntries;if(h<=o)return a=m(t.slice(i,n+1)),r(a,this.toBBox),a;e||(e=Math.ceil(Math.log(h)/Math.log(o)),o=Math.ceil(h/Math.pow(o,e-1))),(a=m([])).leaf=!1,a.height=e;var s,f,l,u,c=Math.ceil(h/o),x=c*Math.ceil(Math.sqrt(o));for(d(t,i,n,x,this.compareMinX),s=i;s<=n;s+=x)for(d(t,s,l=Math.min(s+x-1,n),c,this.compareMinY),f=s;f<=l;f+=c)u=Math.min(f+c-1,l),a.children.push(this._build(t,f,u,e-1));return r(a,this.toBBox),a},_chooseSubtree:function(t,i,n,e){for(var r,a,h,o,s,l,u,c;e.push(i),!i.leaf&&e.length-1!==n;){for(u=c=1/0,r=0,a=i.children.length;r<a;r++)s=f(h=i.children[r]),(l=function(t,i){return(Math.max(i.maxX,t.maxX)-Math.min(i.minX,t.minX))*(Math.max(i.maxY,t.maxY)-Math.min(i.minY,t.minY))}(t,h)-s)<c?(c=l,u=s<u?s:u,o=h):l===c&&s<u&&(u=s,o=h);i=o||i.children[0]}return i},_insert:function(t,i,n){var e=this.toBBox,r=n?t:e(t),a=[],o=this._chooseSubtree(r,this.data,i,a);for(o.children.push(t),h(o,r);i>=0&&a[i].children.length>this._maxEntries;)this._split(a,i),i--;this._adjustParentBBoxes(r,a,i)},_split:function(t,i){var n=t[i],e=n.children.length,a=this._minEntries;this._chooseSplitAxis(n,a,e);var h=this._chooseSplitIndex(n,a,e),o=m(n.children.splice(h,n.children.length-h));o.height=n.height,o.leaf=n.leaf,r(n,this.toBBox),r(o,this.toBBox),i?t[i-1].children.push(o):this._splitRoot(n,o)},_splitRoot:function(t,i){this.data=m([t,i]),this.data.height=t.height+1,this.data.leaf=!1,r(this.data,this.toBBox)},_chooseSplitIndex:function(t,i,n){var e,r,h,o,s,l,u,c;for(l=u=1/0,e=i;e<=n-i;e++)o=function(t,i){var n=Math.max(t.minX,i.minX),e=Math.max(t.minY,i.minY),r=Math.min(t.maxX,i.maxX),a=Math.min(t.maxY,i.maxY);return Math.max(0,r-n)*Math.max(0,a-e)}(r=a(t,0,e,this.toBBox),h=a(t,e,n,this.toBBox)),s=f(r)+f(h),o<l?(l=o,c=e,u=s<u?s:u):o===l&&s<u&&(u=s,c=e);return c},_chooseSplitAxis:function(t,i,n){var e=t.leaf?this.compareMinX:o,r=t.leaf?this.compareMinY:s;this._allDistMargin(t,i,n,e)<this._allDistMargin(t,i,n,r)&&t.children.sort(e)},_allDistMargin:function(t,i,n,e){t.children.sort(e);var r,o,s=this.toBBox,f=a(t,0,i,s),u=a(t,n-i,n,s),c=l(f)+l(u);for(r=i;r<n-i;r++)o=t.children[r],h(f,t.leaf?s(o):o),c+=l(f);for(r=n-i-1;r>=i;r--)o=t.children[r],h(u,t.leaf?s(o):o),c+=l(u);return c},_adjustParentBBoxes:function(t,i,n){for(var e=n;e>=0;e--)h(i[e],t)},_condense:function(t){for(var i,n=t.length-1;n>=0;n--)0===t[n].children.length?n>0?(i=t[n-1].children).splice(i.indexOf(t[n]),1):this.clear():r(t[n],this.toBBox)},_initFormat:function(t){var i=["return a"," - b",";"];this.compareMinX=new Function("a","b",i.join(t[0])),this.compareMinY=new Function("a","b",i.join(t[1])),this.toBBox=new Function("a","return {minX: a"+t[0]+", minY: a"+t[1]+", maxX: a"+t[2]+", maxY: a"+t[3]+"};")}}},{quickselect:2}],2:[function(t,i,n){"use strict";function e(t,i,n,e,a){r(t,i,n||0,e||t.length-1,a||function(t,i){return t<i?-1:t>i?1:0})}function r(t,i,n,e,h){for(;e>n;){if(e-n>600){var o=e-n+1,s=i-n+1,f=Math.log(o),l=.5*Math.exp(2*f/3),u=.5*Math.sqrt(f*l*(o-l)/o)*(s-o/2<0?-1:1);r(t,i,Math.max(n,Math.floor(i-s*l/o+u)),Math.min(e,Math.floor(i+(o-s)*l/o+u)),h)}var c=t[i],m=n,d=e;for(a(t,n,i),h(t[e],c)>0&&a(t,n,e);m<d;){for(a(t,m,d),m++,d--;h(t[m],c)<0;)m++;for(;h(t[d],c)>0;)d--}0===h(t[n],c)?a(t,n,d):a(t,++d,e),d<=i&&(n=d+1),i<=d&&(e=d-1)}}function a(t,i,n){var e=t[i];t[i]=t[n],t[n]=e}i.exports=e,i.exports.default=e},{}]},{},[1])(1)});

/**
 * CS 站点基础Marker
 *
 * Features :
 *      1. 设置options.minZoom/maxZoom控制marker的最大最小显示等级
 *      2. 可重设style以设置自己特色的样式，忽略layer's options的统一样式;属性名与layer's options一致
 *      3. Tip: style中的name,value属性用于判断是否启用style中关于name,value等相关的样式，
 *              而options中的name,value用于控制显隐
 *
 * Update Note：
 *      + v1.5.0 ：Created
 *      + v1.5.1 : 增加图片可以旋转的支持
 *
 * @class LW.CsBaseMarker
 * @extends L.Class
 */
LW.CsBaseMarker = L.Class.extend({
    options:{
        minZoom:0,
        maxZoom:18
    },

    initialize: function (latlng,data,options) {
        L.stamp(this);
        L.setOptions(this,options);
        this.style = {};
        this.setData(latlng,data);
    },

    setData:function(latlng,data){
        this.data = data;
        this._latlng = L.latLng(latlng);
        return this;
    },

    getLatLng: function () {
        return this._latlng;
    },

    visible: function(zoom,isLOD){
        if(isLOD && !isNaN(this.data.minZoom) && !isNaN(this.options.maxZoom))
            return zoom >= this.data.minZoom && zoom <= this.data.maxZoom;
        else
            return zoom >= this.options.minZoom && zoom <= this.options.maxZoom;
    },

    _getOption:function(name,options){
        return this.style.hasOwnProperty(name) ? this.style[name] : options[name];
    },

    _drawDot:function (ctx,pos,options) {
        // Tip: 由于取图片为异步，初次载入时可能地图已经被拖动，会渲染无用的图片，故将位置保存
        this.position = pos;
        var self = this;
        if(this._getOption('dot',options)){
            var dotType = this._getOption('dotType',options);
            if(dotType === 'circle' || dotType==='triangle' || dotType==='rect'){
                var a = dotType==='circle'?(this._getOption('radius',options)):(this._getOption('side',options)),
                    fill = this._getOption('fill',options),
                    stroke = this._getOption('stroke',options),
                    strokeWidth = this._getOption('strokeWidth',options);
                var _dot = LW.VectorCache[dotType](a,fill,stroke,strokeWidth,this._getOption('dotRotation',options));
                ctx.drawImage(_dot,pos.x-_dot.width/2,pos.y-_dot.height/2);
            }
            else if(dotType==='image' || dotType==='dyImage'){
                var src = dotType==='dyImage' && options.dyImageUrlFun ?
                    options.dyImageUrlFun(this.data):options.imageUrl;
                var imgSize = src.imageSize || this.style.imageSize || options.imageSize;
                var imageAnchor = src.imageAnchor || this.style.imageAnchor || options.imageAnchor;
                var rotate = src.dotRotation || this.style.dotRotation || options.dotRotation;
                src = src.url ? src.url : src;
                this._drawImage(ctx,src,-imageAnchor[0],-imageAnchor[1],imgSize[0], imgSize[1],rotate);
            }
            else if(dotType === 'iconfont'){
                ctx.fillStyle=  this._getOption('fill',options);
                ctx.font= this._getOption('dotIconfont',options);
                var unicode = this._getOption('dotUnicode',options);
                var icon = eval(('("'+unicode).replace('&#x','\\u').replace(';','')+'")');
                var anchor = this._getOption('imageAnchor',options);
                ctx.textAlign = 'center';
                var stroke = this._getOption('stroke',options);
                if(stroke){
                    ctx.strokeStyle = stroke;
                    ctx.lineWidth = this._getOption('strokeWidth',options);
                    ctx.strokeText(icon, pos.x, pos.y+anchor[1]);
                }
                ctx.fillText(icon, pos.x, pos.y+anchor[1]);
            }
        }
    },

    _drawName:function (ctx,pos,options) {
        this.name = this.data[options.nameField];
        if(options.name)
            this._drawText(ctx,pos,options,this.name,'name');
    },

    _drawTime:function (ctx, pos, options) {
        if(options.time){
            var time = this.data[options.timeField];
            var timeText = time?new Date(time.replace(/-/g, '/')).format(options.timeFormat):'';
            this._drawText(ctx,pos,options,timeText,'time');
        }
    },

    _drawLabel: function(ctx,pos,options) {
        if(options.visible){
            var label = this.data[options.field] || '';
            this._drawText(ctx,pos,options,label,'');
        }
    },

    _drawText:function (ctx,pos,options,text,key){
        var offset = this.style[key+'_offset'] || options[key+'_offset'];
        if(this.style[key+'_font'])
            ctx.font = this.style[key+'_font'];
        if(options[key+'_stroke'] || this.style[key+'_stroke']){
            if(this.style[key+'_stroke'])
                ctx.strokeStyle = this.style[key+'_stroke'];
            if(this.style[key+'_lineWidth'])
                ctx.lineWidth = this.style[key+'_lineWidth'];
            ctx.strokeText(text, pos.x + offset.x, pos.y+offset.y);
        }
        if(this.style[key+'_color'])
            ctx.fillStyle = this.style[key+'_color'];
        ctx.fillText(text, pos.x + offset.x, pos.y+offset.y);
    },

    _drawImage : function (ctx,src, x, y, width, height, rotate) {
        var self = this;
        LW.ResourceCache.getImage(src, function (img) {
            // var x = positions[src].x, y = positions[src].y;
            var _x = self.position.x + x, _y = self.position.y + y;
            if (rotate) {//如果有rotate，则旋转
                var x0 = _x + width / 2, y0 = _y + height / 2;
                ctx.translate(x0, y0);
                ctx.rotate(rotate * Math.PI / 180);
                ctx.translate(-x0, -y0);
            }
            ctx.drawImage(img, _x, _y, width, height);
            if (rotate)
                ctx.setTransform(1, 0, 0, 1, 0, 0);
        });
    }
});

LW.csBaseMarker = function (latlng,data,options) {
    return new LW.CsBaseMarker(latlng,data,options);
};

LW.CsZdzMarker = LW.CsBaseMarker.extend({
    _setValue : function (options) {
        var value = this.value = this.data[options.valueField];
        if(value){
            if(options.valueScale!==1){
                value =  value * options.valueScale;
                value = this.value = Sun.Util.Math.toFixed(value,3);
            }

            if(options.legendData && options.legendData.length>0)
                this.style.fill = Sun.Util.LegendData.getColorOfRangeLegend(options.legendData, value);
        }
        return value;
    },

    _drawValue:function (ctx,pos,options) {
        if(options.value){
            var value = this.value || '';
            this._drawText(ctx,pos,options,value,'value');
        }
    },

    _drawWind:function (ctx,pos,options) {
        var dir = this.dir = this.data[options.dirField];
        if(dir && this.value){
            Sun.Util.Geometry.drawWindByPosition(ctx,this.value,dir,pos,true,options.wind_height,options.wind_width);
        }
    }
});

LW.csZdzMarker = function (latlng,data,options) {
    return new LW.CsZdzMarker(latlng,data,options);
};

LW.CsMultiIconMarker = LW.CsZdzMarker.extend({
    _setWidth:function(options){
        var items = this.data.data;
        this.width = items.length*options.mIconSize[0]+(items.length-1)*options.mIconGap;
    },
    getIcon:function(x,y,options){
        var pos = this.position;
        var iw = options.mIconSize[0],ih = options.mIconSize[1],iy = options.mIcon_y||-options.mIconSize[1];
        var in_y = (y-pos.y)<(iy+ih);
        if(in_y){
            var idx_x = Math.floor((x-pos.x+this.width/2)/(iw+options.mIconGap));
            var offset_x = -this.width/2+idx_x*(iw+options.mIconGap)+iw/2;
            return {index:idx_x,data:this.data.data[idx_x],offset:{x:offset_x,y:iy}};
        }
    },
    _drawMultiIcon:function (ctx, pos, options) {
        var items = this.data.data;
        // Tip: 由于取图片为异步，初次载入时可能地图已经被拖动，会渲染无用的图片，故将位置保存
        this.position = pos;
        var w = this.width,self = this,positions = {};
        for(var i=0;i<items.length;i++) {
            var item = items[i];
            var x = -w / 2 + i * (options.mIconSize[0] + options.mIconGap);
            var y = options.mIcon_y || -options.mIconSize[1];
            // 绘制图标
            var src = options.mIconUrlFun(item);
            // Tip: 由于取图片为异步，初次可能再载入时地图已经被拖动，会渲染无用的图片，故将位置保存
            // positions[src] = {x: x, y: y};
            this._drawImage(ctx,src, x,y,options.mIconSize[0],options.mIconSize[1],item.rotate);
            // 绘制时间
            if (options.time) {
                ctx.font = options.time_font;
                ctx.textAlign = 'center';
                ctx.fillStyle = options.time_color;
                ctx.lineWidth = options.time_lineWidth;
                if (options.time_stroke)
                    ctx.strokeStyle = options.time_stroke;
                this._drawTime(ctx, L.point(pos.x + x + options.mIconSize[0] / 2, pos.y), options, item);
            }
        }
    }
});
LW.csMultiIconMarker = function (latlng,data,options) {
    return new LW.CsMultiIconMarker(latlng,data,options);
};


/**
 * CS图层
 * @module Layer.CS
 */

/**
 * CS 站点基础图层
 *
 * Features :
 *      1. 基于r-tree快速查找
 *      2. 渲染于canvas
 *      3. 可设置属性minZoom/maxZoom控制图层的最大最小显示等级
 *
 * Update Note：
 *      + v1.5.0 ：Created
 *      + v1.5.2 : 1. 鼠标移过不同icon的事件增强
 *                 2. 增加dot类型为iconfont的支持
 *
 * @class LW.CsBaseLayer
 * @extends LW.CanvasLayer
 * @demo demo/base/cs/csLayer_dyImage.html  {动态图片}
 */
LW.CsBaseLayer = LW.CanvasLayer.extend({
    options:{
        /**
         * 侦听的事件
         * @property events
         * @type {Array}
         * @default ['click','dblclick','contextmenu','mousemove']
         */
        events:['click','dblclick','contextmenu','mousemove'],
        /**
         * 不冒泡的事件
         * @property nonBubblingEvents
         * @type {Array}
         * @default ['click','dblclick']
         */
        nonBubblingEvents: ['click','dblclick'],
        /**
         * 响应事件的所有目标
         * @property responseAllTargets
         * @type {boolean}
         * @default false
         */
        responseAllTargets:false,
        /**
         * 渲染器
         * @property renderer
         * @type {L.Canvas}
         * @default LW.canvas({pane: 'markerPane'})
         */
        renderer: LW.canvas({pane: 'markerPane'}),
        /**
         * marker热区的大小，用于marker的鼠标事件判定,不设置会引起鼠标事件无法使用
         * @property hotSize
         * @type {Array}
         * @default [0,0]
         */
        hotSize:[0,0],
        /**
         * marker热区的偏移量
         * @property hotOffset
         * @type {Array}
         * @default {x:0,y:0}
         */
        hotOffset:{x:0,y:0},
        /**
         * Marker 实例
         * @property markerInstance
         * @type {LW.CsBaseMarker}
         * @default LW.csBaseMarker
         */
        markerInstance: LW.csBaseMarker,
        /**
         * 纬度字段名
         * @property latField
         * @type {String}
         * @default 'LAT'
         */
        latField:'LAT',
        /**
         * 经度字段名
         * @property lonField
         * @type {String}
         * @default 'LON'
         */
        lonField:'LON',
        /**
         * 图层展示最小等级
         * @property minZoom
         * @type {int}
         * @default 0
         */
        minZoom:0,
        /**
         * 图层展示最大等级
         * @property maxZoom
         * @type {int}
         * @default 18
         */
        maxZoom:18,
        /**
         * 文本显示的最小等级，即等级大于等于该等级才能显示
         * @property textMinZoom
         * @type {int}
         * @default 7
         */
        textMinZoom:7,
        // --> 站名
        /**
         * 是否展示站名
         * @property name
         * @type {Boolean}
         * @default true
         */
        name:true,
        /**
         * 站名字段
         * @property nameField
         * @type {string}
         * @default 'STATIONNAME'
         */
        nameField:'STATIONNAME',
        /**
         * 站名的颜色
         * @property name_color
         * @type {string}
         * @default '#000'
         */
        name_color:'#000',
        /**
         * 站名的字体
         * @property name_font
         * @type {string}
         * @default '14px Microsoft Yahei'
         */
        name_font:'14px Microsoft Yahei',
        /**
         * 站名描边粗细
         * @property name_lineWidth
         * @type {int}
         * @default 2
         */
        name_lineWidth: 2,
        /**
         * 站名的描边,是否描边/描边的颜色
         * @property name_stroke
         * @type {String|Boolean}
         * @default '#fff'
         */
        name_stroke:'#fff',
        /**
         * 站名的y值，可调整站名y方向上的位置，x方向居中
         * @property name_offset
         * @type {object}
         * @default {x:0,y:20}
         */
        name_offset:{x:0,y:20},

        // --> 中心标识点
        /**
         * 是否展示站点标识点
         * @property dot
         * @type {Boolean}
         * @default true
         */
        dot:true,
        /**
         * 中心点的类型
         *
         * 可选类型 :
         *      1. circle--圆形
         *      2. triangle--三角形
         *      3. image--固定图片，需设置imageUrl
         *      4. dyImage--动态图片，需设置dyImageUrlFun
         *      5. iconfont--iconfont字体图标
         * @property dotType
         * @type {string}
         * @default 'circle'
         */
        dotType:'circle',

        dotRotation:null,

        /**
         * iconfont字体，dotType为iconfont时设置
         * @property dotIconfont
         * @type {string}
         * @default '20px iconfont'
         */
        dotIconfont:'20px iconfont',

        /**
         * iconfont字体的编码，dotType为iconfont时设置,且为必填项
         * @property dotUnicode
         * @type {string}
         * @default ''
         */
        dotUnicode:'',

        /**
         * 图片地址，dotType为image时设置
         * @property imageUrl
         * @type {string}
         * @default ''
         */
        imageUrl:'',
        /**
         * 图片地址方法，dotType为dyImage时设置
         * @property dyImageUrlFun
         * @type {function}
         * @default ''
         */
        dyImageUrlFun:null,
        /**
         * 图片大小，dotType为image或dyImage时设置
         * @property imageSize
         * @type {Array}
         * @default [10,16]
         */
        imageSize:[10,16],
        /**
         * 图片锚点（中心点），一般为图片大小的一半
         * @property imageAnchor
         * @type {Array}
         * @default [5,8]
         */
        imageAnchor:[5,8],
        /**
         * dot的填充颜色，dotType为circle或droplet时设置
         * @property fill
         * @type {string}
         * @default '#fff'
         */
        fill:'#fff',
        /**
         * dot的描边颜色，dotType为circle或triangle时设置
         * @property stroke
         * @type {string|Boolean}
         * @default false
         */
        stroke:false,
        /**
         * dot的描边的粗细，dotType为circle或triangle时设置
         * @property strokeWidth
         * @type {int}
         * @default 1
         */
        strokeWidth:1,
        /**
         * dot的半径，dotType为circle设置
         * @property radius
         * @type {number}
         * @default 3
         */
        radius:3,

        /**
         * 三角形边长，dotType为triangle时设置
         * @property side
         * @type {int}
         * @default 10
         */
        side:10,

        //--> 时间文本
        /**
         * 是否展示时间文本
         * @property time
         * @type {Boolean}
         * @default true
         */
        time:false,
        /**
         * 时间字段
         * @property timeField
         * @type {string}
         * @default ''
         */
        timeField:'',
        /**
         * 时间文本的颜色
         * @property time_color
         * @type {string}
         * @default '#000'
         */
        time_color:'#000',
        /**
         * 时间文本的字体
         * @property time_font
         * @type {string}
         * @default '12px Microsoft Yahei'
         */
        time_font:'12px Microsoft Yahei',
        /**
         * 时间文本描边粗细
         * @property time_lineWidth
         * @type {int}
         * @default 2
         */
        time_lineWidth: 2,
        /**
         * 时间文本的描边,是否描边/描边的颜色
         * @property time_stroke
         * @type {String|Boolean}
         * @default '#fff'
         */
        time_stroke:'#fff',
        /**
         * 时间文本的y值，可调整站名y方向上的位置，x方向居中
         * @property time_offset
         * @type {number}
         * @default {x:0,y:20}
         */
        time_offset:{x:0,y:20},
        /**
         * 时间文本的格式
         * @property time_y
         * @type {String}
         * @default 'MM-dd hh:mm'
         */
        timeFormat: 'MM-dd hh:mm',

        /**
         * 当前展示是否分级
         * @property isLOD
         * @type {Boolean}
         * @default false
         */
        isLOD:false,

        /**
         * 分级模型
         * @property LODModel
         * @type {LW.LODModel|null}
         * @default null
         */
        LODModel:null,

        /**
         * 对markers做渲染前的处理
         *      1. 如对查找出的markers重新排序；对marker根据指定的需求变换样式
         *      2. 按该方法返回的新marker序列绘制
         * @property reformMarkersFn
         * @type {Function|null}
         * @default 'null'
         */
        reformMarkersFn:null
    },

    initialize: function (options) {
        L.setOptions(this, options);
        this._initListeners();
    },

    _initListeners:function(){
        var listeners = this._listeners={};
        var events = this.options.events.slice();
        /**
         * Tip: 因为其不需要侦听canvas本身的mouseover/mouseout,而是侦听canvas的mousemove在鼠标在具体的对象上时发出相应事件,
         *      所以只在这里加入这事件的listener
         */
        events.push('mouseover','mouseout')
        for(var i=0;i<events.length;i++){
            var e = events[i];
            listeners[e] = [];
        }
    },

    onAdd: function (map) {
        this._renderer = this._map.getRenderer(this);
        var self = this;
        this.options.events.forEach(function (e) {
            // L.DomEvent.on(self._renderer._container,e,self._executeListeners,self);
            // self._map.on(e, self._executeListeners, self);

            // Tip:用map无法停止向map冒泡，用_renderer无法触发旁系_renderer的事件
            L.DomEvent.on(self._map._mapPane,e,self._executeListeners,self);
        });

        if(this.data)
            !this.drawed?this._setData(this.data):this._update();
    },

    onRemove: function (map) {
        var self = this;
        this.options.events.forEach(function (e) {
            // if(self._renderer)
            //     L.DomEvent.off(self._renderer._container,e,self._executeListeners,self);
            // self._map.off(e,self._executeListeners,self);
            L.DomEvent.off(self._map._mapPane,e,self._executeListeners,self);
        });
        LW.CanvasLayer.prototype.onRemove.call(this,map);
    },

    addTo: function (map) {
        map.addLayer(this);
        return this;
    },

    /**
     * 重设options，并重绘
     * @method setOptions
     * @param options
     * @param textOptions {Boolean} 是否是文本相关属性，如果是则检查地图当前等级是否大于textMinZoom，若是才重绘
     */
    setOptions:function (options,textOptions) {
        L.setOptions(this, options);
        if(this._map){
            if((textOptions && this._map.getZoom()>=this.options.textMinZoom) || !textOptions || this.options.isLOD)
                this._update();
        }
    },

    /**
     * 切换是否分级显示
     * @method setLOD
     * @param isLOD {Boolean}
     */
    setLOD:function(isLOD){
        this.options.isLOD = isLOD;
        if(this._map)
            this._update();
    },

    getLayers:function(bounds){
        var boxCoords = this._getBoxCoords(bounds);
        return this._latlngMarkers.search(boxCoords);
    },

    _getBoxCoords:function(bounds){
        return {
            minX: bounds.getWest(),minY: bounds.getSouth(),
            maxX: bounds.getEast(),maxY: bounds.getNorth(),
        };
    },

    /**
     * 设置数据
     * @method setData
     * @param data
     * @return {LW.CsBaseLayer}
     */
    setData: function (data) {
        this.data = data;
        this.drawed = false;

        // 初始化画布和rbush
        this._markers = new rbush();//当前展示的markers,用于事件判定
        this._latlngMarkers = new rbush();//所有markers
        this._latlngMarkers.dirty=0;
        this._latlngMarkers.total=0;

        if(!this._moving)//Tip：如果在拖动的过程中被重设数据，可设置数据但不渲染，所以此时也不做清空
            this.clear();
        // 设置数据
        if(this._map)
            this._setData(data);
        return this;
    },

    _getLatlng: function (item) {
        var lat = item[this.options.latField],lng = item[this.options.lonField];
        return L.latLng(lat,lng);
    },

    _setData:function (data) {
        if(!data) return;

        if(this.options.LODModel){
            // var d1 = new Date();
            this.options.LODModel.options.valueField = this.options.valueField;
            this.options.LODModel.setData(data);
            // var d2 = new Date();
            // console.log('分级：',(d2.getTime()-d1.getTime())/1000+'s');
        }

        var tmpLatLng = [];
        for(var i=0;i<data.length;i++){
            var marker = this._createMarker(data[i]);
            tmpLatLng.push(marker);
        }
        this._latlngMarkers.load(tmpLatLng);
        this._update();
        this.drawed = true;
    },

    _createMarker:function(item){
        var options = this.options;
        var latlng = this._getLatlng(item);
        var m = options.markerInstance(latlng, item);
        return this.addMarker(m,latlng);
    },

    addMarker: function (marker,latlng) {
        var rect = {
            minX: latlng.lng,
            minY: latlng.lat,
            maxX: latlng.lng,
            maxY: latlng.lat,
            data: marker
        };

        this._latlngMarkers.dirty++;
        this._latlngMarkers.total++;
        return rect;
    },

    removeMarker: function (marker,redraw) {
        //If we are removed point
        if(marker["minX"]) marker = marker.data;

        var latlng = marker.getLatLng();
        var isDisplaying = this._map.getBounds().contains(latlng);

        var markerData = {
            minX: latlng.lng,
            minY: latlng.lat,
            maxX: latlng.lng,
            maxY: latlng.lat,
            data: marker
        };

        this._latlngMarkers.remove(markerData, function (a,b) {
            // Tip:一定要加这个才能移除成功
            return a.data._leaflet_id ===b.data._leaflet_id;
        });
        this._latlngMarkers.total--;
        this._latlngMarkers.dirty++;

        if(isDisplaying ===true && redraw ===true)
            this._update();
    },

    _update: function (e) {
        if(e) this._moving = false;
        if(this._map && !this._moving){
            // var d1 = new Date().getTime();
            this.clear();
            var zoom = this._map.getZoom();
            if(this.options.isLOD && this.options.LODModel) {
                // var d1 = new Date();
                this.options.LODModel.getData(zoom);
                // var d2 = new Date();
                // console.log('lod:',zoom,' time:',(d2.getTime()-d1.getTime())/1000+'s');
            }
            if(zoom>=this.options.minZoom && zoom<=this.options.maxZoom)
                this._redraw();
            // var d2 = new Date().getTime();
            // console.log('update',(d2-d1)/1000+'s');
        }
    },

    _redraw: function (clear) {
        var map = this._map,moving = this._moving;
        if (!this._latlngMarkers) return;

        var tmp = [];
        //If we are 10% individual inserts\removals, reconstruct lookup for efficiency
        if (this._latlngMarkers.dirty/this._latlngMarkers.total >= .1) {
            this._latlngMarkers.all().forEach(function(e) {
                tmp.push(e);
            });
            this._latlngMarkers.clear();
            this._latlngMarkers.load(tmp);
            this._latlngMarkers.dirty=0;
            tmp = [];
        }

        var mapBounds = this._map.getBounds();

        //Only re-draw what we are showing on the map.
        var mapBoxCoords = this._getBoxCoords(mapBounds);

        var markers = this._latlngMarkers.search(mapBoxCoords);
        var options = this.options;
        markers.forEach(function (e) {
            var marker = e.data;
            var pointPos = marker.position = map.latLngToContainerPoint(marker.getLatLng());
            var hotSize = marker.style.hotSize || options.hotSize;
            var hotOffset = marker.style.hotOffset || options.hotOffset;
            var width = Math.max(hotSize[0],marker.width||0);
            var adj_x = width/2;
            var adj_y = hotSize[1]/2;
            var newCoords = {
                minX: (pointPos.x + hotOffset.x - adj_x),
                minY: (pointPos.y + hotOffset.y - adj_y),
                maxX: (pointPos.x + hotOffset.x + adj_x),
                maxY: (pointPos.y + hotOffset.y + adj_y),
                data: marker
            };
            tmp.push(newCoords);
        });
        // Tip: 对markers做渲染前的处理，如对查找出的markers重新排序；对marker根据指定的需求变换样式
        if(this.options.reformMarkersFn)
            markers = this.options.reformMarkersFn(markers);
        this._drawMarker(markers);

        this._markers.clear();
        this._markers.load(tmp);
    },

    eachLayer: function (method, context) {
        if(this._latlngMarkers){
            this._latlngMarkers.all().forEach(function(e) {
                method.call(context, e.data);
            });
        }
        return this;
    },

    /**
     * 重绘当前界面的marker点
     * @method drawMarker
     */
    drawMarker : function(){
        this.clear();
        this._drawMarker(this._markers.all());
    },

    _drawMarker:function(markers){
        if(markers.length>0) {
            var map = this._map, zoom = map.getZoom();
            var ctx = this._renderer._ctx,options=this.options;
            //Tip：layer层遍历绘制，而不是marker直接绘制，是为了单种要素的层次，例如：希望站值总是在所有站名之上
            this._drawDot(markers,ctx,options,zoom);
            this._drawName(markers,ctx,options,zoom);
        }
    },

    _drawDot:function(markers,ctx,options,zoom){
        if(options.dot){
            markers.forEach(function (e) {
                var marker = e.data;
                if(marker.visible(zoom,options.isLOD))
                    marker._drawDot(ctx, marker.position,options);
            });
        }
    },

    _drawName:function(markers,ctx,options,zoom){
        if(this._textVisible(options,zoom,options.name))
            this._drawText(markers,ctx,options,'name','_drawName',zoom);
    },

    _drawText: function(markers,ctx,options,key,funKey,zoom){
        ctx.textAlign = options[key+'_textAlign'] || 'center';
        ctx.font = options[key+'_font'];
        ctx.fillStyle = options[key+'_color'];
        ctx.lineWidth=options[key+'_lineWidth'];
        if(options[key+'_stroke'])
            ctx.strokeStyle = options[key+'_stroke'];
        var sMarkers = [];
        markers.forEach(function (e) {
            var marker = e.data;
            if(marker.visible(zoom,options.isLOD)){
                if(marker.style[key])
                    sMarkers.push(marker);
                else if(options[key] != 'overShow')
                    marker[funKey](ctx,marker.position,options);
            }
        });
        sMarkers.forEach(function (m) {
            m[funKey](ctx,m.position,options);
        })
    },

    _textVisible:function (options,zoom,typeVisible) {
        return options.isLOD ? typeVisible : (zoom>=options.textMinZoom && typeVisible);
    },

    on:function(type,fn,context){
        var listener = this._listeners[type];
        if(listener)
            listener.push(fn);
        return LW.CanvasLayer.prototype.on.call(this,type,fn,context);
    },

    _executeListeners: function (event) {
        if(!this._markers)
            return;
        // event = event.originalEvent;
        var self = this;
        var x = event.offsetX;
        var y = event.offsetY;

        var ret = this._markers.search({ minX: x, minY: y, maxX: x, maxY: y });

        if (ret && ret.length > 0) {
            self._map._container.overId = self._leaflet_id;
            self._map._container.style.cursor="pointer";
            var eType = event.type,trigger=true;
            if(eType == 'mousemove'){
                // Tip: 当鼠标移过marker时，转发mouseover事件
                eType = 'mouseover';
                var overTarget = ret[0].data._leaflet_id;
                if(self.options.mIconEvent&&self.getIndexIcon){//Tip: 如果是icon则overTarget具体到icon
                    var icon = self.getIndexIcon(event, ret[0].data);
                    if(icon)
                        overTarget = overTarget+'_'+icon.index;
                }
                trigger = this._overTarget == overTarget ? false : true;
                this._overTarget = overTarget;
            }
            var listener = this._listeners[eType];
            if(listener && trigger)
                excute(listener);

            if(this.options.nonBubblingEvents.indexOf(event.type)!==-1)
                event.stopPropagation();
            if(event.type === 'contextmenu')
                event.preventDefault();
        }
        else {
            if(self._map._container.overId == self._leaflet_id)
                self._map._container.style.cursor="";
            if(this._overTarget){
                this.fire('mouseout');
                this._overTarget = null;
            }
        }

        function excute(listener) {
            listener.forEach(function (fn) {
                if(self.options.mIconEvent&&self.getIndexIcon){
                    // Tip: 多icon的marker事件分为单icon点击和整体点击
                    var icon = self.getIndexIcon(event, ret[0].data, fn);
                    fn.call(self,event,ret[0].data,icon);
                }
                else
                    fn.call(self,event, self.options.responseAllTargets?ret:ret[0].data);
            });
        }
    }
});
/**
 * @class LW.CsBaseLayer
 * @constructor
 * @param options {object} 外部属性，可重设Properties
 * @returns {LW.CsBaseLayer}
 */
LW.csBaseLayer = function (options) {
    return new LW.CsBaseLayer(options);
};
/**
 * CS 文本图层（市县名图层）
 *
 * Update Note：
 *      + v1.5.0 ：Created
 *
 * @class LW.CsLabelLayer
 * @extends LW.CsBaseLayer
 * @demo demo/base/cs/csLayer_cityname.html  {镇名图层}
 */
LW.CsLabelLayer = LW.CsBaseLayer.extend({
    options:{
        nameField: 'NAME',
        locationField: 'LOCATION',
        dot:false,
        name_offset:{x:0,y:0}
    },

    _getLatlng: function (item) {
        var latlng = item[this.options.locationField][0];
        return L.latLng(latlng[1],latlng[0]);
    }
});

/**
 * @class LW.CsLabelLayer
 * @constructor
 * @param options {object} 外部属性，可重设Properties
 * @returns {LW.CsLabelLayer}
 */
LW.csLabelLayer = function (options) {
    return new LW.CsLabelLayer(options);
};
/**
 * CS 自动站图层
 *
 * Update Note：
 *      + v1.5.0 ：Created
 *
 * @class LW.CsZdzLayer
 * @extends LW.CsBaseLayer
 * @demo demo/base/cs/csLayer.html  {自动站}
 * @demo demo/base/cs/csLayer_wind.html  {风}
 * @demo demo/base/cs/csLayer_visible.html  {能见度}
 * @demo demo/base/cs/csLayer_iconfont.html  {iconfont图标}
 */
LW.CsZdzLayer = LW.CsBaseLayer.extend({
    options:{
        /**
         * 是否可交互，用于能见度图层点击出现能见度圈
         * @property interactive
         * @type {Boolean}
         * @default true
         */
        interactive:true,
        /**
         * Marker 实例
         * @property markerInstance
         * @type {LW.CsBaseMarker}
         * @default LW.csZdzMarker
         */
        markerInstance: LW.csZdzMarker,
        /**
         * 纬度字段名
         * @property latField
         * @type {String}
         * @default 'STATIONLAT'
         */
        latField:'STATIONLAT',
        /**
         * 经度字段名
         * @property lonField
         * @type {String}
         * @default 'STATIONLON'
         */
        lonField:'STATIONLON',
        /**
         * 图例，主要用于dot为绘制时，为不同图例范围的值显示不同的填色
         * @property legendData
         * @type {Array|null}
         * @default null
         */
        legendData:null,

        // --> 站值
        /**
         * 是否展示站值
         * @property value
         * @type {Boolean}
         * @default true
         */
        value:true,
        /**
         * 站值字段
         * @property valueField
         * @type {string}
         * @default ''
         */
        valueField:'',
        /**
         * 站值缩放比, 终值 = 值 * valueScale
         * @property valueScale
         * @type {number}
         * @default 1
         */
        valueScale:1,
        /**
         * 无效值
         * @property invalidValue
         * @type {number}
         * @default 9999
         */
        invalidValue:9999,

        /**
         * 站值的颜色
         * @property value_color
         * @type {string}
         * @default '#333'
         */
        value_color:'#333',
        /**
         * 站值的字体
         * @property value_font
         * @type {string}
         * @default '12px Microsoft Yahei'
         */
        value_font:'12px Microsoft Yahei',

        /**
         * 站值的y值，可调整站名y方向上的位置，x方向居中
         * @property value_offset
         * @type {object}
         * @default {x:0,y:-10}
         */
        value_offset:{x:0,y:-10},
        /**
         * 值是否描边
         * @property value_stroke
         * @type {Boolean}
         * @default '#fff'
         */
        value_stroke:'#fff',
        /**
         * 站值描边粗细
         * @property value_lineWidth
         * @type {int}
         * @default 2
         */
        value_lineWidth: 2,
        //--> 风杆
        /**
         * 是否绘制风
         * @property wind
         * @type {Boolean}
         * @default false
         */
        wind:false,
        /**
         * 风杆显示最小等级
         * @property wind_lineWidth
         * @type {number}
         * @default 7
         */
        windVaneMinZoom:7,
        /**
         * 风向字段名
         * @property dirField
         * @type {string}
         * @default ''
         */
        dirField:'',
        /**
         * 风杆的颜色
         * @property wind_color
         * @type {string}
         * @default '#111'
         */
        wind_color:'#111',
        /**
         * 风杆颜色也由色谱去填色的阈值，大于此值则填数值对应色谱的颜色
         * @property windVaneColorfulValue
         * @type {number}
         * @default 10.8
         */
        windVaneColorfulValue:10.8,
        /**
         * 风杆宽度
         * @property wind_width
         * @type {number}
         * @default 8
         */
        wind_width:8,
        /**
         * 风杆长度
         * @property wind_height
         * @type {number}
         * @default 25
         */
        wind_height:25,
        /**
         * 风杆绘制宽度
         * @property wind_lineWidth
         * @type {number}
         * @default 1
         */
        wind_lineWidth:1

        // isExMarker:false,//是否是极值marker
        // showZero:false,//是否展示0值
    },

    _createMarker:function(item){
        var options = this.options;
        var latlng = this._getLatlng(item);
        var m = options.markerInstance(latlng, item);
        m._setValue(options);
        return this.addMarker(m,latlng);
    },

    _drawMarker:function(markers){
        if(markers.length>0){
            var map = this._map,zoom = map.getZoom();
            var ctx = this._renderer._ctx,options=this.options;
            this._drawWind(markers,ctx,options,zoom);
            this._drawDot(markers,ctx,options,zoom);
            this._drawName(markers,ctx,options,zoom);
            this._drawTime(markers,ctx,options,zoom);
            this._drawValue(markers,ctx,options,zoom);
        }
    },

    _drawWind:function(markers,ctx,options,zoom){
        if(options.wind){
            if(zoom>=options.windVaneMinZoom){
                ctx.strokeStyle = options.wind_color;
                ctx.lineWidth = options.wind_lineWidth;
                markers.forEach(function (e) {
                    var marker = e.data;
                    if(marker.visible(zoom,options.isLOD))
                        marker._drawWind(ctx,marker.position,options);
                });
            }
        }
    },

    _drawValue:function(markers,ctx,options,zoom){
        if(this._textVisible(options,zoom,options.value))
            this._drawText(markers,ctx,options,'value','_drawValue',zoom);
    },

    _drawTime:function(markers,ctx,options,zoom){
        if(this._textVisible(options,zoom,options.time))
            this._drawText(markers,ctx,options,'time','_drawTime',zoom);
    }
});

/**
 * @class LW.CsZdzLayer
 * @constructor
 * @param options {object} 外部属性，可重设Properties
 * @returns {LW.CsZdzLayer}
 */
LW.csZdzLayer = function (options) {
    return new LW.CsZdzLayer(options);
};
/**
 * CS 自动站-风图层
 */
LW.csZdzWindLayer = function (options) {
    options = options || {};
    options.wind = true;
    return new LW.CsZdzLayer(options);
};
/**
 * CS 自动站-能见度图层
 *
 * Update Note：
 *      + v1.5.0 ：Created
 *
 * @class LW.CsZdzVisibleLayer
 * @extends LW.CsBaseLayer
 * @demo demo/base/cs/csLayer_visible.html  {能见度}
 */
LW.CsZdzVisibleLayer = LW.CsZdzLayer.extend({
    options:{
        valueScale:0.001
    },

    // 能见度范围圈
    visibleRangeCircle: null,

    initialize: function (options) {
        LW.CsZdzLayer.prototype.initialize.call(this, options);
        if (!this.visibleRangeCircle && this.options.interactive)
            this.visibleRangeCircle = L.circle([0, 0], 0, {
                color: '#fe7a04',
                fillColor: '#fee904',
                fillOpacity: 0.2,
                weight: 1
            });
    },

    onAdd: function (map) {
        LW.CsZdzLayer.prototype.onAdd.call(this, map);
        this.on('click', this._showRange);
        if (this.visibleRangeCircle && map)
            map.addLayer(this.visibleRangeCircle);
    },

    onRemove: function (map) {
        LW.CsZdzLayer.prototype.onRemove.call(this, map);
        this.off('click', this._showRange);
        if (this.visibleRangeCircle && map)
            map.removeLayer(this.visibleRangeCircle);
    },

    setData: function (data) {
        LW.CsZdzLayer.prototype.setData.call(this,data);
        if (this.visibleRangeCircle)
            this.visibleRangeCircle.setRadius(0);
    },

    _showRange: function (e,marker,content) {
        if(this.visibleRangeCircle){
            var value = marker.value*1000;
            this.visibleRangeCircle.setLatLng(marker.getLatLng());
            this.visibleRangeCircle.setRadius(value);
        }
    }
});
/**
 * @class LW.CsZdzVisibleLayer
 * @constructor
 * @param options {object} 外部属性，可重设Properties
 * @returns {LW.CsZdzVisibleLayer}
 */
LW.csZdzVisibleLayer = function (options) {
    return new LW.CsZdzVisibleLayer(options);
};

/**
 * CS 自动站-综合填图图层(多文本展现图层)
 *
 * Update Note：
 *      + v1.5.0 ：Created
 *
 * @class LW.CsMultiLabelLayer
 * @extends LW.CsZdzLayer
 * @demo demo/base/cs/cs_multiLabel.html  {多文本/综合填图}
 */
LW.CsMultiLabelLayer = LW.CsZdzLayer.extend({
    options:{
        /**
         * 文本的配置
         * @property labelOptions
         * @type {Array}
         * @default []
         *
         * eg: [
                //Tip:key不能用'value'
                {key:'rain',visible:true,field:'',_offset:L.point(0,0),_color:'',_stroke:'',_font:'',_lineWidth:2},
                {key:'temp',visible:true,field:'',_offset:L.point(0,0),_color:'',_stroke:'',_font:'',_lineWidth:2}
            ]
         */
        labelOptions: []
    },

    _drawValue:function(markers,ctx,options,zoom){
        if(this._textVisible(options,zoom,true)){
            for(var i=0;i<this.options.labelOptions.length;i++){
                var item = this.options.labelOptions[i];
                this._drawText(markers,ctx,item,'','_drawLabel',zoom);
            }
        }
    },

    /**
     * 设置文本显隐
     * @method setLabelVisible
     * @param key {string} 文本的key
     * @param visible {boolean}
     */
    setLabelVisible:function(key,visible){
        var item = Sun.Util.Array.getItemByField(this.options.labelOptions,'key',key);
        if(item.visible != visible){
            item.visible = visible;
            this.setOptions({},true);
        }
    }
});
/**
 * @class LW.CsMultiLabelLayer
 * @constructor
 * @param options {object} 外部属性，可重设Properties
 * @returns {LW.CsMultiLabelLayer}
 */
LW.csMultiLabelLayer = function (options) {
    return new LW.CsMultiLabelLayer(options);
};

/**
 * CS 多Icon的图层
 *
 * Features :
 *      1. setData 的数据结构 [{id:'0',name:'xxx',lat:'27.5',lon:'117.3',data:[{}]},...]
 *      2. 鼠标事件支持整个marker响应或单个icon响应
 *
 * Update Note：
 *      + v1.5.0 ：Created
 *
 * @class LW.CsMultiIconLayer
 * @extends LW.CsBaseLayer
 * @demo demo/base/cs/cs_multiIcon.html  {多ICON}
 */
LW.CsMultiIconLayer = LW.CsZdzLayer.extend({
    options:{
        /**
         * Marker 实例
         * @property markerInstance
         * @type {LW.CsBaseMarker}
         * @default LW.csMultiIconMarker
         */
        markerInstance:LW.csMultiIconMarker,
        /**
         * mIcon y方向位置
         * @property mIcon_y
         * @type {int}
         * @default -30
         */
        mIcon_y:-30,
        /**
         * 单个icon的size
         * @property mIconSize
         * @type {Array}
         * @default [20,20]
         */
        mIconSize:[20,20],
        /**
         * icon之间的间隔
         * @property mIconGap
         * @type {number}
         * @default 0
         */
        mIconGap:0,
        /**
         * 获取icon图片地址的function
         * @property mIconUrlFun
         * @type {function}
         * @default null
         */
        mIconUrlFun:null,
        /**
         * icon显示的等级
         * @property mIconZoom
         * @type {int}
         * @default 0
         */
        mIconZoom:0,
        /**
         * icon是否支持鼠标事件，若是点击可返回指定的icon
         * @property mIconEvent
         * @type {Boolean}
         * @default true
         */
        mIconEvent:true
    },

    _createMarker:function(item){
        var options = this.options;
        var latlng = this._getLatlng(item);
        var m = options.markerInstance(latlng, item);
        m._setValue(options);
        m._setWidth(options);
        return this.addMarker(m,latlng);
    },

    _drawMarker:function(markers){
        if(markers.length>0) {
            var map = this._map, zoom = map.getZoom();
            var ctx = this._renderer._ctx,options=this.options;
            //Tip：layer层遍历绘制，而不是marker直接绘制，是为了单种要素的层次，例如：希望站值总是在所有站名之上
            this._drawDot(markers,ctx,options,zoom);
            this._drawName(markers,ctx,options,zoom);
            this._drawMultiIcon(markers,ctx,options,zoom);
        }
    },

    _drawMultiIcon:function(markers,ctx,options,zoom){
        if(zoom>=options.mIconZoom){
            markers.forEach(function (e) {
                var marker = e.data;
                marker._drawMultiIcon(ctx, marker.position,options);
            });
        }
    },

    getIndexIcon:function (e,marker,fn) {
        return marker.getIcon(e.offsetX,e.offsetY,this.options);
    }
});
/**
 * @class LW.CsMultiIconLayer
 * @constructor
 * @param options {object} 外部属性，可重设Properties
 * @returns {LW.CsMultiIconLayer}
 */
LW.csMultiIconLayer = function (options) {
    return new LW.CsMultiIconLayer(options);
};


LW.BlinkCavans=LW.NoTranslateCanvas.extend({

    _updateBlink:function (layer) {
        var data = layer._points,
            ctx = this._ctx,
            r = layer._radius;
        s=1,that=this;

        this._drawnLayers[layer._leaflet_id] = layer;
        this.clear();
        data.forEach(function (size) {
            var gradient = ctx.createRadialGradient(size.x, size.y, 0, size.x, size.y, r * 2);
            gradient.addColorStop(0.2, "rgba(255,255,255,0)");
            var color=size.color||layer.options.color;
            gradient.addColorStop(0.6, color);
            ctx.fillStyle = gradient;
            ctx.lineWidth = 1;
            ctx.strokeStyle = size.color||layer.options.color;
            ctx.beginPath();
            ctx.arc(size.x, size.y / s, r, 0, Math.PI * 2, false);
            ctx.stroke();
            ctx.fill();
            ctx.closePath();
        })
    },
    clear:function () {
        if(this._ctx)
            this._ctx.clearRect(0, 0, this._container.width, this._container.height);
    }
});
/**
 * 闪烁图层
 * Features :
 *      1. 内发光闪烁图层
 *
 * Update Note：
 *      + v1.5.1-alpha ：Created
 *
 * @class LW.BlinkLayer
 * @extends L.BlinkLayer
 */
LW.BlinkLayer=L.Path.extend({
    options:{
        renderer:new LW.BlinkCavans(),
        interactive:false,
        /**
         * 纬度字段名
         * @property latField
         * @type {string}
         * @default 'STATIONLAT'
         */
        latField: "STATIONLAT",

        /**
         * 经度字段名
         * @property lonField
         * @type {string}
         * @default 'STATIONLON'
         */
        lonField: "STATIONLON",
        colorField:"color",
        radius:30,
    },
    _containsPoint:function () {
        return false;
    },
    initialize:function (options) {
        L.setOptions(this,options);
        this._radius=5;
    },
    setData:function (data) {
        this.data=data;
        this._reset();
    },
    _project:function () {
        var that=this;
        this._points=[];
        if(this.data==null||this.data.length==0){
            this._pxBounds = new L.Bounds([L.point(0,0)]);
            return;
        }

        this.data.forEach(function (item) {
            var p=that._map.latLngToContainerPoint(L.latLng(item[that.options["latField"]],item[that.options["lonField"]]));
            var i={x:p.x,y:p.y,color:item[that.options["colorField"]]};
            that._points.push(i);
        });
        this._pxBounds = new L.Bounds(this._points);
    },
    getEvents: function () {
        return {
            //zoomend: L.Util.falseFn,
            moveend: this._reset,// 原先这个事件是用this._update方法作为回调，但浏览器由小变大会有bug,renderer的size认不到
            viewreset: this._reset
        };
    },
    _update: function () {
        var that=this;
        if (this._map) {
            this._updatePath();
        }
        if(this.interval)
            clearInterval(this.interval);

        this.interval=setInterval(function () {
            that._radius += 2;
            that._updatePath();
            if (that._radius > that.options.radius)
                that._radius = 5;
        }, 100)

    },
    _updatePath:function () {
        if(this._renderer)
            this._renderer._updateBlink(this);
    },
    onRemove: function () {
        if (this._map.hasLayer(this._renderer))
            this._map.removeLayer(this._renderer);
    },
    clearLayers:function () {
        if(this._renderer)
            this._renderer.clear();
        this.data=[];
        this._reset();
    }
});

LW.Editable = L.Evented.extend({

    statics: {
        FORWARD: 1,
        BACKWARD: -1
    },

    options: {

        // You can pass them when creating a map using the `editOptions` key.
        // 🍂option zIndex: int = 1000
        // The default zIndex of the editing tools.
        zIndex: 1000,

        // 🍂option polygonClass: class = L.Polygon
        // Class to be used when creating a new Polygon.
        polygonClass: L.Polygon,

        // 🍂option polylineClass: class = L.Polyline
        // Class to be used when creating a new Polyline.
        polylineClass: L.Polyline,

        // 🍂option markerClass: class = L.Marker
        // Class to be used when creating a new Marker.
        markerClass: L.Marker,

        // 🍂option rectangleClass: class = L.Rectangle
        // Class to be used when creating a new Rectangle.
        rectangleClass: L.Rectangle,

        // 🍂option circleClass: class = L.Circle
        // Class to be used when creating a new Circle.
        circleClass: L.Circle,

        // 🍂option drawingCSSClass: string = 'leaflet-editable-drawing'
        // CSS class to be added to the map container while drawing.
        drawingCSSClass: 'leaflet-editable-drawing',

        // 🍂option drawingCursor: const = 'crosshair'
        // Cursor mode set to the map while drawing.
        drawingCursor: 'crosshair',

        // 🍂option editLayer: Layer = new L.LayerGroup()
        // Layer used to store edit tools (vertex, line guide…).
        editLayer: undefined,

        // 🍂option featuresLayer: Layer = new L.LayerGroup()
        // Default layer used to store drawn features (Marker, Polyline…).
        featuresLayer: undefined,

        // 🍂option polylineEditorClass: class = PolylineEditor
        // Class to be used as Polyline editor.
        polylineEditorClass: undefined,

        // 🍂option polygonEditorClass: class = PolygonEditor
        // Class to be used as Polygon editor.
        polygonEditorClass: undefined,

        // 🍂option markerEditorClass: class = MarkerEditor
        // Class to be used as Marker editor.
        markerEditorClass: undefined,

        // 🍂option rectangleEditorClass: class = RectangleEditor
        // Class to be used as Rectangle editor.
        rectangleEditorClass: undefined,

        // 🍂option circleEditorClass: class = CircleEditor
        // Class to be used as Circle editor.
        circleEditorClass: undefined,

        // 🍂option lineGuideOptions: hash = {}
        // Options to be passed to the line guides.
        lineGuideOptions: {},

        // 🍂option skipMiddleMarkers: boolean = false
        // Set this to true if you don't want middle markers.
        skipMiddleMarkers: true

    },

    initialize: function (map, options) {
        L.setOptions(this, options);
        this._lastZIndex = this.options.zIndex;
        this.map = map;
        this.editLayer = this.createEditLayer();
        this.featuresLayer = this.createFeaturesLayer();
        this.forwardLineGuide = this.createLineGuide();
        this.backwardLineGuide = this.createLineGuide();
    },

    fireAndForward: function (type, e) {
        e = e || {};
        e.editTools = this;
        this.fire(type, e);
        this.map.fire(type, e);
    },

    createLineGuide: function () {
        var options = L.extend({
            dashArray: '5,10',
            weight: 1,
            interactive: false,
            color: '#33fffb'
        }, this.options.lineGuideOptions);
        return L.polyline([], options);
    },

    createVertexIcon: function (options) {
        return L.Browser.touch ? new LW.Editable.TouchVertexIcon(options) : new LW.Editable.VertexIcon(options);
    },

    createEditLayer: function () {
        return this.options.editLayer || new L.LayerGroup().addTo(this.map);
    },

    createFeaturesLayer: function () {
        return this.options.featuresLayer || new L.LayerGroup().addTo(this.map);
    },

    moveForwardLineGuide: function (latlng) {
        if (this.forwardLineGuide._latlngs.length) {
            this.forwardLineGuide._latlngs[1] = latlng;
            this.forwardLineGuide._bounds.extend(latlng);
            this.forwardLineGuide.redraw();
        }
    },

    moveBackwardLineGuide: function (latlng) {
        if (this.backwardLineGuide._latlngs.length) {
            this.backwardLineGuide._latlngs[1] = latlng;
            this.backwardLineGuide._bounds.extend(latlng);
            this.backwardLineGuide.redraw();
        }
    },

    anchorForwardLineGuide: function (latlng) {
        this.forwardLineGuide._latlngs[0] = latlng;
        this.forwardLineGuide._bounds.extend(latlng);
        this.forwardLineGuide.redraw();
    },

    anchorBackwardLineGuide: function (latlng) {
        this.backwardLineGuide._latlngs[0] = latlng;
        this.backwardLineGuide._bounds.extend(latlng);
        this.backwardLineGuide.redraw();
    },

    attachForwardLineGuide: function () {
        this.editLayer.addLayer(this.forwardLineGuide);
    },

    attachBackwardLineGuide: function () {
        this.editLayer.addLayer(this.backwardLineGuide);
    },

    detachForwardLineGuide: function () {
        this.forwardLineGuide.setLatLngs([]);
        this.editLayer.removeLayer(this.forwardLineGuide);
    },

    detachBackwardLineGuide: function () {
        this.backwardLineGuide.setLatLngs([]);
        this.editLayer.removeLayer(this.backwardLineGuide);
    },

    blockEvents: function () {
        // Hack: force map not to listen to other layers events while drawing.
        if (!this._oldTargets) {
            this._oldTargets = this.map._targets;
            this.map._targets = {};
        }
    },

    unblockEvents: function () {
        if (this._oldTargets) {
            // Reset, but keep targets created while drawing.
            this.map._targets = L.extend(this.map._targets, this._oldTargets);
            delete this._oldTargets;
        }
    },

    registerForDrawing: function (editor) {
        if (this._drawingEditor) this.unregisterForDrawing(this._drawingEditor);
        this.blockEvents();
        editor.reset();  // Make sure editor tools still receive events.
        this._drawingEditor = editor;
        this.map.on('mousemove touchmove', editor.onDrawingMouseMove, editor);
        this.map.on('mousedown', this.onMousedown, this);
        this.map.on('mouseup', this.onMouseup, this);
        L.DomUtil.addClass(this.map._container, this.options.drawingCSSClass);
        this.defaultMapCursor = this.map._container.style.cursor;
        this.map._container.style.cursor = this.options.drawingCursor;
    },

    unregisterForDrawing: function (editor) {
        this.unblockEvents();
        L.DomUtil.removeClass(this.map._container, this.options.drawingCSSClass);
        this.map._container.style.cursor = this.defaultMapCursor;
        editor = editor || this._drawingEditor;
        if (!editor) return;
        this.map.off('mousemove touchmove', editor.onDrawingMouseMove, editor);
        this.map.off('mousedown', this.onMousedown, this);
        this.map.off('mouseup', this.onMouseup, this);
        if (editor !== this._drawingEditor) return;
        delete this._drawingEditor;
        if (editor._drawing) editor.cancelDrawing();
    },

    onMousedown: function (e) {
        this._mouseDown = e;
        this._drawingEditor.onDrawingMouseDown(e);
    },

    onMouseup: function (e) {
        if (this._mouseDown) {
            var editor = this._drawingEditor,
                mouseDown = this._mouseDown;
            this._mouseDown = null;
            editor.onDrawingMouseUp(e);
            if (this._drawingEditor !== editor) return;  // onDrawingMouseUp may call unregisterFromDrawing.
            var origin = L.point(mouseDown.originalEvent.clientX, mouseDown.originalEvent.clientY);
            var distance = L.point(e.originalEvent.clientX, e.originalEvent.clientY).distanceTo(origin);
            if (Math.abs(distance) < 9 * (window.devicePixelRatio || 1)) this._drawingEditor.onDrawingClick(e);
        }
    },

    // 🍂section Public methods
    // You will generally access them by the `map.editTools`
    // instance:
    //
    // `map.editTools.startPolyline();`

    // 🍂method drawing(): boolean
    // Return true if any drawing action is ongoing.
    drawing: function () {
        return this._drawingEditor && this._drawingEditor.drawing();
    },

    // 🍂method stopDrawing()
    // When you need to stop any ongoing drawing, without needing to know which editor is active.
    stopDrawing: function () {
        this.unregisterForDrawing();
    },

    // 🍂method commitDrawing()
    // When you need to commit any ongoing drawing, without needing to know which editor is active.
    commitDrawing: function (e) {
        if (!this._drawingEditor) return;
        this._drawingEditor.commitDrawing(e);
    },

    connectCreatedToMap: function (layer) {
        return this.featuresLayer.addLayer(layer);
    },

    // 🍂method startPolyline(latlng: L.LatLng, options: hash): L.Polyline
    // Start drawing a Polyline. If `latlng` is given, a first point will be added. In any case, continuing on user click.
    // If `options` is given, it will be passed to the Polyline class constructor.
    startPolyline: function (latlng, options) {
        var line = this.createPolyline([], options);
        line.enableEdit(this.map).newShape(latlng);
        return line;
    },

    startProfileline: function (latlng,options) {
        var line = this.createProfileline([],options);
        // this.connectCreatedToMap(line);
        line.enableEdit(this.map).newShape(latlng);
        return line;
    },

    // 🍂method startPolygon(latlng: L.LatLng, options: hash): L.Polygon
    // Start drawing a Polygon. If `latlng` is given, a first point will be added. In any case, continuing on user click.
    // If `options` is given, it will be passed to the Polygon class constructor.
    startPolygon: function (latlng, options) {
        var polygon = this.createPolygon([], options);
        polygon.enableEdit(this.map).newShape(latlng);
        return polygon;
    },

    // 🍂method startMarker(latlng: L.LatLng, options: hash): L.Marker
    // Start adding a Marker. If `latlng` is given, the Marker will be shown first at this point.
    // In any case, it will follow the user mouse, and will have a final `latlng` on next click (or touch).
    // If `options` is given, it will be passed to the Marker class constructor.
    startMarker: function (latlng, options) {
        latlng = latlng || this.map.getCenter().clone();
        var marker = this.createMarker(latlng, options);
        marker.enableEdit(this.map).startDrawing();
        return marker;
    },

    // 🍂method startRectangle(latlng: L.LatLng, options: hash): L.Rectangle
    // Start drawing a Rectangle. If `latlng` is given, the Rectangle anchor will be added. In any case, continuing on user drag.
    // If `options` is given, it will be passed to the Rectangle class constructor.
    startRectangle: function (latlng, options) {
        var corner = latlng || L.latLng([0, 0]);
        var bounds = new L.LatLngBounds(corner, corner);
        var rectangle = this.createRectangle(bounds, options);
        rectangle.enableEdit(this.map).startDrawing();
        return rectangle;
    },

    // 🍂method startCircle(latlng: L.LatLng, options: hash): L.Circle
    // Start drawing a Circle. If `latlng` is given, the Circle anchor will be added. In any case, continuing on user drag.
    // If `options` is given, it will be passed to the Circle class constructor.
    startCircle: function (latlng, options) {
        latlng = latlng || this.map.getCenter().clone();
        var circle = this.createCircle(latlng, options);
        circle.enableEdit(this.map).startDrawing();
        return circle;
    },

    startHole: function (editor, latlng) {
        editor.newHole(latlng);
    },

    createLayer: function (klass, latlngs, options) {
        options = L.Util.extend({editOptions: {editTools: this}}, options);
        var layer = new klass(latlngs, options);
        // 🍂namespace Editable
        // 🍂event editable:created: LayerEvent
        // Fired when a new feature (Marker, Polyline…) is created.
        this.fireAndForward('editable:created', {layer: layer});
        return layer;
    },

    createPolyline: function (latlngs, options) {
        return this.createLayer(options && options.polylineClass || this.options.polylineClass, latlngs, options);
    },
    createProfileline: function (latlngs, options) {
        options = L.Util.extend({profileLine:true,color:'#33fffb'}, options);
        return this.createLayer(options && options.polylineClass || this.options.polylineClass, latlngs, options);
    },

    createPolygon: function (latlngs, options) {
        return this.createLayer(options && options.polygonClass || this.options.polygonClass, latlngs, options);
    },

    createMarker: function (latlng, options) {
        return this.createLayer(options && options.markerClass || this.options.markerClass, latlng, options);
    },

    createRectangle: function (bounds, options) {
        return this.createLayer(options && options.rectangleClass || this.options.rectangleClass, bounds, options);
    },

    createCircle: function (latlng, options) {
        return this.createLayer(options && options.circleClass || this.options.circleClass, latlng, options);
    }

});

L.extend(LW.Editable, {

    makeCancellable: function (e) {
        e.cancel = function () {
            e._cancelled = true;
        };
    }

});

// 🍂namespace Map; 🍂class Map
// Leaflet.Editable add options and events to the `L.Map` object.
// See `Editable` events for the list of events fired on the Map.
// 🍂example
//
// ```js
// var map = L.map('map', {
//  editable: true,
//  editOptions: {
//    …
// }
// });
// ```
// 🍂section Editable Map Options
L.Map.mergeOptions({

    // 🍂namespace Map
    // 🍂section Map Options
    // 🍂option editToolsClass: class = LW.Editable
    // Class to be used as vertex, for path editing.
    editToolsClass: LW.Editable,

    // 🍂option editable: boolean = false
    // Whether to create a LW.Editable instance at map init.
    editable: false,

    // 🍂option editOptions: hash = {}
    // Options to pass to LW.Editable when instanciating.
    editOptions: {}

});

L.Map.addInitHook(function () {

    this.whenReady(function () {
        if (this.options.editable) {
            this.editTools = new this.options.editToolsClass(this, this.options.editOptions);
        }
    });

});

LW.Editable.VertexIcon = L.DivIcon.extend({
    options: {
        iconSize: new L.Point(12, 12),
        iconAnchor: new L.Point(6, 6)
    }

});

LW.Editable.TouchVertexIcon = LW.Editable.VertexIcon.extend({

    options: {
        iconSize: new L.Point(12, 12)
    }

});


// 🍂namespace Editable; 🍂class VertexMarker; Handler for dragging path vertices.
LW.Editable.VertexMarker = L.Marker.extend({

    options: {
        draggable: true,
        className: 'leaflet-div-icon leaflet-vertex-icon'
    },


    // 🍂section Public methods
    // The marker used to handle path vertex. You will usually interact with a `VertexMarker`
    // instance when listening for events like `editable:vertex:ctrlclick`.

    initialize: function (latlng, latlngs, editor, options) {
        // We don't use this._latlng, because on drag Leaflet replace it while
        // we want to keep reference.
        this.latlng = latlng;
        this.latlngs = latlngs;
        this.editor = editor;
        L.Marker.prototype.initialize.call(this, latlng, options);
        this.options.icon = this.editor.tools.createVertexIcon(this.options);
        this.latlng.__vertex = this;
        this.editor.editLayer.addLayer(this);
        this.setZIndexOffset(editor.tools._lastZIndex + 1);
    },

    onAdd: function (map) {
        L.Marker.prototype.onAdd.call(this, map);
        this.on('drag', this.onDrag);
        this.on('dragstart', this.onDragStart);
        this.on('dragend', this.onDragEnd);
        this.on('mouseup', this.onMouseup);
        this.on('click', this.onClick);
        this.on('contextmenu', this.onContextMenu);
        this.on('mousedown touchstart', this.onMouseDown);
        this.addMiddleMarkers();
    },

    onRemove: function (map) {
        if (this.middleMarker) this.middleMarker.delete();
        delete this.latlng.__vertex;
        this.off('drag', this.onDrag);
        this.off('dragstart', this.onDragStart);
        this.off('dragend', this.onDragEnd);
        this.off('mouseup', this.onMouseup);
        this.off('click', this.onClick);
        this.off('contextmenu', this.onContextMenu);
        this.off('mousedown touchstart', this.onMouseDown);
        L.Marker.prototype.onRemove.call(this, map);
    },

    onDrag: function (e) {
        e.vertex = this;
        this.editor.onVertexMarkerDrag(e);
        var iconPos = L.DomUtil.getPosition(this._icon),
            latlng = this._map.layerPointToLatLng(iconPos);
        this.latlng.update(latlng);
        this._latlng = this.latlng;  // Push back to Leaflet our reference.
        this.editor.refresh();
        if (this.middleMarker) this.middleMarker.updateLatLng();
        var next = this.getNext();
        if (next && next.middleMarker) next.middleMarker.updateLatLng();
    },

    onDragStart: function (e) {
        e.vertex = this;
        this.editor.onVertexMarkerDragStart(e);
    },

    onDragEnd: function (e) {
        e.vertex = this;
        this.editor.onVertexMarkerDragEnd(e);
    },

    onClick: function (e) {
        e.vertex = this;
        this.editor.onVertexMarkerClick(e);
    },

    onMouseup: function (e) {
        L.DomEvent.stop(e);
        e.vertex = this;
        this.editor.map.fire('mouseup', e);
    },

    onContextMenu: function (e) {
        e.vertex = this;
        this.editor.onVertexMarkerContextMenu(e);
    },

    onMouseDown: function (e) {
        e.vertex = this;
        this.editor.onVertexMarkerMouseDown(e);
    },

    // 🍂method delete()
    // Delete a vertex and the related LatLng.
    delete: function () {
        var next = this.getNext();  // Compute before changing latlng
        this.latlngs.splice(this.getIndex(), 1);
        this.editor.editLayer.removeLayer(this);
        this.editor.onVertexDeleted({latlng: this.latlng, vertex: this});
        if (!this.latlngs.length) this.editor.deleteShape(this.latlngs);
        if (next) next.resetMiddleMarker();
        this.editor.refresh();
    },

    // 🍂method getIndex(): int
    // Get the index of the current vertex among others of the same LatLngs group.
    getIndex: function () {
        return this.latlngs.indexOf(this.latlng);
    },

    // 🍂method getLastIndex(): int
    // Get last vertex index of the LatLngs group of the current vertex.
    getLastIndex: function () {
        return this.latlngs.length - 1;
    },

    // 🍂method getPrevious(): VertexMarker
    // Get the previous VertexMarker in the same LatLngs group.
    getPrevious: function () {
        if (this.latlngs.length < 2) return;
        var index = this.getIndex(),
            previousIndex = index - 1;
        if (index === 0 && this.editor.CLOSED) previousIndex = this.getLastIndex();
        var previous = this.latlngs[previousIndex];
        if (previous) return previous.__vertex;
    },

    // 🍂method getNext(): VertexMarker
    // Get the next VertexMarker in the same LatLngs group.
    getNext: function () {
        if (this.latlngs.length < 2) return;
        var index = this.getIndex(),
            nextIndex = index + 1;
        if (index === this.getLastIndex() && this.editor.CLOSED) nextIndex = 0;
        var next = this.latlngs[nextIndex];
        if (next) return next.__vertex;
    },

    addMiddleMarker: function (previous) {
        if (!this.editor.hasMiddleMarkers()) return;
        previous = previous || this.getPrevious();
        if (previous && !this.middleMarker) this.middleMarker = this.editor.addMiddleMarker(previous, this, this.latlngs, this.editor);
    },

    addMiddleMarkers: function () {
        if (!this.editor.hasMiddleMarkers()) return;
        var previous = this.getPrevious();
        if (previous) this.addMiddleMarker(previous);
        var next = this.getNext();
        if (next) next.resetMiddleMarker();
    },

    resetMiddleMarker: function () {
        if (this.middleMarker) this.middleMarker.delete();
        this.addMiddleMarker();
    },

    // 🍂method split()
    // Split the vertex LatLngs group at its index, if possible.
    split: function () {
        if (!this.editor.splitShape) return;  // Only for PolylineEditor
        this.editor.splitShape(this.latlngs, this.getIndex());
    },

    // 🍂method continue()
    // Continue the vertex LatLngs from this vertex. Only active for first and last vertices of a Polyline.
    continue: function () {
        if (!this.editor.continueBackward) return;  // Only for PolylineEditor
        var index = this.getIndex();
        if (index === 0) this.editor.continueBackward(this.latlngs);
        else if (index === this.getLastIndex()) this.editor.continueForward(this.latlngs);
    }

});

LW.Editable.mergeOptions({

    // 🍂namespace Editable
    // 🍂option vertexMarkerClass: class = VertexMarker
    // Class to be used as vertex, for path editing.
    vertexMarkerClass: LW.Editable.VertexMarker

});

LW.Editable.MiddleMarker = L.Marker.extend({

    options: {
        opacity: 0.5,
        className: 'leaflet-div-icon leaflet-middle-icon',
        draggable: true
    },

    initialize: function (left, right, latlngs, editor, options) {
        this.left = left;
        this.right = right;
        this.editor = editor;
        this.latlngs = latlngs;
        L.Marker.prototype.initialize.call(this, this.computeLatLng(), options);
        this._opacity = this.options.opacity;
        this.options.icon = this.editor.tools.createVertexIcon({className: this.options.className});
        this.editor.editLayer.addLayer(this);
        this.setVisibility();
    },

    setVisibility: function () {
        var leftPoint = this._map.latLngToContainerPoint(this.left.latlng),
            rightPoint = this._map.latLngToContainerPoint(this.right.latlng),
            size = L.point(this.options.icon.options.iconSize);
        if (leftPoint.distanceTo(rightPoint) < size.x * 3) this.hide();
        else this.show();
    },

    show: function () {
        this.setOpacity(this._opacity);
    },

    hide: function () {
        this.setOpacity(0);
    },

    updateLatLng: function () {
        this.setLatLng(this.computeLatLng());
        this.setVisibility();
    },

    computeLatLng: function () {
        var leftPoint = this.editor.map.latLngToContainerPoint(this.left.latlng),
            rightPoint = this.editor.map.latLngToContainerPoint(this.right.latlng),
            y = (leftPoint.y + rightPoint.y) / 2,
            x = (leftPoint.x + rightPoint.x) / 2;
        return this.editor.map.containerPointToLatLng([x, y]);
    },

    onAdd: function (map) {
        L.Marker.prototype.onAdd.call(this, map);
        L.DomEvent.on(this._icon, 'mousedown touchstart', this.onMouseDown, this);
        map.on('zoomend', this.setVisibility, this);
    },

    onRemove: function (map) {
        delete this.right.middleMarker;
        L.DomEvent.off(this._icon, 'mousedown touchstart', this.onMouseDown, this);
        map.off('zoomend', this.setVisibility, this);
        L.Marker.prototype.onRemove.call(this, map);
    },

    onMouseDown: function (e) {
        var iconPos = L.DomUtil.getPosition(this._icon),
            latlng = this.editor.map.layerPointToLatLng(iconPos);
        e = {
            originalEvent: e,
            latlng: latlng
        };
        if (this.options.opacity === 0) return;
        LW.Editable.makeCancellable(e);
        this.editor.onMiddleMarkerMouseDown(e);
        if (e._cancelled) return;
        this.latlngs.splice(this.index(), 0, e.latlng);
        this.editor.refresh();
        var icon = this._icon;
        var marker = this.editor.addVertexMarker(e.latlng, this.latlngs);
        /* Hack to workaround browser not firing touchend when element is no more on DOM */
        var parent = marker._icon.parentNode;
        parent.removeChild(marker._icon);
        marker._icon = icon;
        parent.appendChild(marker._icon);
        marker._initIcon();
        marker._initInteraction();
        marker.setOpacity(1);
        /* End hack */
        // Transfer ongoing dragging to real marker
        L.Draggable._dragging = false;
        marker.dragging._draggable._onDown(e.originalEvent);
        this.delete();
    },

    delete: function () {
        this.editor.editLayer.removeLayer(this);
    },

    index: function () {
        return this.latlngs.indexOf(this.right.latlng);
    }

});

LW.Editable.mergeOptions({

    // 🍂namespace Editable
    // 🍂option middleMarkerClass: class = VertexMarker
    // Class to be used as middle vertex, pulled by the user to create a new point in the middle of a path.
    middleMarkerClass: LW.Editable.MiddleMarker

});

// 🍂namespace Editable; 🍂class BaseEditor; 🍂aka LW.Editable.BaseEditor
// When editing a feature (Marker, Polyline…), an editor is attached to it. This
// editor basically knows how to handle the edition.
LW.Editable.BaseEditor = L.Handler.extend({

    initialize: function (map, feature, options) {
        L.setOptions(this, options);
        this.map = map;
        this.feature = feature;
        this.feature.editor = this;
        this.editLayer = new L.LayerGroup();
        this.tools = this.options.editTools || map.editTools;
    },

    // 🍂method enable(): this
    // Set up the drawing tools for the feature to be editable.
    addHooks: function () {
        if (this.isConnected()) this.onFeatureAdd();
        else this.feature.once('add', this.onFeatureAdd, this);
        this.onEnable();
        this.feature.on(this._getEvents(), this);
        return;
    },

    // 🍂method disable(): this
    // Remove the drawing tools for the feature.
    removeHooks: function () {
        this.feature.off(this._getEvents(), this);
        if (this.feature.dragging) this.feature.dragging.disable();
        this.editLayer.clearLayers();
        this.tools.editLayer.removeLayer(this.editLayer);
        this.onDisable();
        if (this._drawing) this.cancelDrawing();
        return;
    },

    // 🍂method drawing(): boolean
    // Return true if any drawing action is ongoing with this editor.
    drawing: function () {
        return !!this._drawing;
    },

    reset: function () {
    },

    onFeatureAdd: function () {
        this.tools.editLayer.addLayer(this.editLayer);
        if (this.feature.dragging) this.feature.dragging.enable();
    },

    hasMiddleMarkers: function () {
        return !this.options.skipMiddleMarkers && !this.tools.options.skipMiddleMarkers;
    },

    fireAndForward: function (type, e) {
        e = e || {};
        e.layer = this.feature;
        this.feature.fire(type, e);
        this.tools.fireAndForward(type, e);
    },

    onEnable: function () {
        // 🍂namespace Editable
        // 🍂event editable:enable: Event
        // Fired when an existing feature is ready to be edited.
        this.fireAndForward('editable:enable');
    },

    onDisable: function () {
        // 🍂namespace Editable
        // 🍂event editable:disable: Event
        // Fired when an existing feature is not ready anymore to be edited.
        this.fireAndForward('editable:disable');
    },

    onEditing: function () {
        // 🍂namespace Editable
        // 🍂event editable:editing: Event
        // Fired as soon as any change is made to the feature geometry.
        this.fireAndForward('editable:editing');
    },

    onStartDrawing: function () {
        // 🍂namespace Editable
        // 🍂section Drawing events
        // 🍂event editable:drawing:start: Event
        // Fired when a feature is to be drawn.
        this.fireAndForward('editable:drawing:start');
    },

    onEndDrawing: function () {
        // 🍂namespace Editable
        // 🍂section Drawing events
        // 🍂event editable:drawing:end: Event
        // Fired when a feature is not drawn anymore.
        this.fireAndForward('editable:drawing:end');
    },

    onCancelDrawing: function () {
        // 🍂namespace Editable
        // 🍂section Drawing events
        // 🍂event editable:drawing:cancel: Event
        // Fired when user cancel drawing while a feature is being drawn.
        this.fireAndForward('editable:drawing:cancel');
    },

    onCommitDrawing: function (e) {
        // 🍂namespace Editable
        // 🍂section Drawing events
        // 🍂event editable:drawing:commit: Event
        // Fired when user finish drawing a feature.
        this.fireAndForward('editable:drawing:commit', e);
    },

    onDrawingMouseDown: function (e) {
        // 🍂namespace Editable
        // 🍂section Drawing events
        // 🍂event editable:drawing:mousedown: Event
        // Fired when user `mousedown` while drawing.
        this.fireAndForward('editable:drawing:mousedown', e);
    },

    onDrawingMouseUp: function (e) {
        // 🍂namespace Editable
        // 🍂section Drawing events
        // 🍂event editable:drawing:mouseup: Event
        // Fired when user `mouseup` while drawing.
        this.fireAndForward('editable:drawing:mouseup', e);
    },

    startDrawing: function () {
        if (!this._drawing) this._drawing = LW.Editable.FORWARD;
        this.tools.registerForDrawing(this);
        this.onStartDrawing();
    },

    commitDrawing: function (e) {
        this.onCommitDrawing(e);
        this.endDrawing();
    },

    cancelDrawing: function () {
        // If called during a vertex drag, the vertex will be removed before
        // the mouseup fires on it. This is a workaround. Maybe better fix is
        // To have L.Draggable reset it's status on disable (Leaflet side).
        L.Draggable._dragging = false;
        this.onCancelDrawing();
        this.endDrawing();
    },

    endDrawing: function () {
        this._drawing = false;
        this.tools.unregisterForDrawing(this);
        this.onEndDrawing();
    },

    onDrawingClick: function (e) {
        if (!this.drawing()) return;
        LW.Editable.makeCancellable(e);
        // 🍂namespace Editable
        // 🍂section Drawing events
        // 🍂event editable:drawing:click: CancelableEvent
        // Fired when user `click` while drawing, before any internal action is being processed.
        this.fireAndForward('editable:drawing:click', e);
        if (e._cancelled) return;
        if (!this.isConnected()) this.connect(e);
        this.processDrawingClick(e);
    },

    isConnected: function () {
        return this.map.hasLayer(this.feature);
    },

    connect: function (e) {
        this.tools.connectCreatedToMap(this.feature);
        this.tools.editLayer.addLayer(this.editLayer);
    },

    onMove: function (e) {
        // 🍂namespace Editable
        // 🍂section Drawing events
        // 🍂event editable:drawing:move: Event
        // Fired when `move` mouse while drawing, while dragging a marker, and while dragging a vertex.
        this.fireAndForward('editable:drawing:move', e);
    },

    onDrawingMouseMove: function (e) {
        this.onMove(e);
    },

    _getEvents: function () {
        return {
            dragstart: this.onDragStart,
            drag: this.onDrag,
            dragend: this.onDragEnd,
            remove: this.disable
        };
    },

    onDragStart: function (e) {
        this.onEditing();
        // 🍂namespace Editable
        // 🍂event editable:dragstart: Event
        // Fired before a path feature is dragged.
        this.fireAndForward('editable:dragstart', e);
    },

    onDrag: function (e) {
        this.onMove(e);
        // 🍂namespace Editable
        // 🍂event editable:drag: Event
        // Fired when a path feature is being dragged.
        this.fireAndForward('editable:drag', e);
    },

    onDragEnd: function (e) {
        // 🍂namespace Editable
        // 🍂event editable:dragend: Event
        // Fired after a path feature has been dragged.
        this.fireAndForward('editable:dragend', e);
    }

});

// 🍂namespace Editable; 🍂class MarkerEditor; 🍂aka LW.Editable.MarkerEditor
// 🍂inherits BaseEditor
// Editor for Marker.
LW.Editable.MarkerEditor = LW.Editable.BaseEditor.extend({

    onDrawingMouseMove: function (e) {
        LW.Editable.BaseEditor.prototype.onDrawingMouseMove.call(this, e);
        if (this._drawing) this.feature.setLatLng(e.latlng);
    },

    processDrawingClick: function (e) {
        // 🍂namespace Editable
        // 🍂section Drawing events
        // 🍂event editable:drawing:clicked: Event
        // Fired when user `click` while drawing, after all internal actions.
        this.fireAndForward('editable:drawing:clicked', e);
        this.commitDrawing(e);
    },

    connect: function (e) {
        // On touch, the latlng has not been updated because there is
        // no mousemove.
        if (e) this.feature._latlng = e.latlng;
        LW.Editable.BaseEditor.prototype.connect.call(this, e);
    }

});

// 🍂namespace Editable; 🍂class PathEditor; 🍂aka LW.Editable.PathEditor
// 🍂inherits BaseEditor
// Base class for all path editors.
LW.Editable.PathEditor = LW.Editable.BaseEditor.extend({

    CLOSED: false,
    MIN_VERTEX: 2,

    addHooks: function () {
        LW.Editable.BaseEditor.prototype.addHooks.call(this);
        if (this.feature) this.initVertexMarkers();
        return this;
    },

    initVertexMarkers: function (latlngs) {
        if (!this.enabled()) return;
        latlngs = latlngs || this.getLatLngs();
        if (L.Polyline._flat(latlngs)) this.addVertexMarkers(latlngs);
        else for (var i = 0; i < latlngs.length; i++) this.initVertexMarkers(latlngs[i]);
    },

    getLatLngs: function () {
        return this.feature.getLatLngs();
    },

    // 🍂method reset()
    // Rebuild edit elements (Vertex, MiddleMarker, etc.).
    reset: function () {
        this.editLayer.clearLayers();
        this.initVertexMarkers();
    },

    addVertexMarker: function (latlng, latlngs) {
        return new this.tools.options.vertexMarkerClass(latlng, latlngs, this);
    },

    addVertexMarkers: function (latlngs) {
        for (var i = 0; i < latlngs.length; i++) {
            this.addVertexMarker(latlngs[i], latlngs);
        }
    },

    refreshVertexMarkers: function (latlngs) {
        latlngs = latlngs || this.getDefaultLatLngs();
        for (var i = 0; i < latlngs.length; i++) {
            latlngs[i].__vertex.update();
        }
    },

    addMiddleMarker: function (left, right, latlngs) {
        return new this.tools.options.middleMarkerClass(left, right, latlngs, this);
    },

    onVertexMarkerClick: function (e) {
        LW.Editable.makeCancellable(e);
        // 🍂namespace Editable
        // 🍂section Vertex events
        // 🍂event editable:vertex:click: CancelableVertexEvent
        // Fired when a `click` is issued on a vertex, before any internal action is being processed.
        this.fireAndForward('editable:vertex:click', e);
        if (e._cancelled) return;
        if (this.tools.drawing() && this.tools._drawingEditor !== this) return;
        var index = e.vertex.getIndex(), commit;
        if (e.originalEvent.ctrlKey) {
            this.onVertexMarkerCtrlClick(e);
        } else if (e.originalEvent.altKey) {
            this.onVertexMarkerAltClick(e);
        } else if (e.originalEvent.shiftKey) {
            this.onVertexMarkerShiftClick(e);
        } else if (e.originalEvent.metaKey) {
            this.onVertexMarkerMetaKeyClick(e);
        } else if (index === e.vertex.getLastIndex() && this._drawing === LW.Editable.FORWARD) {
            if (index >= this.MIN_VERTEX - 1) commit = true;
        } else if (index === 0 && this._drawing === LW.Editable.BACKWARD && this._drawnLatLngs.length >= this.MIN_VERTEX) {
            commit = true;
        } else if (index === 0 && this._drawing === LW.Editable.FORWARD && this._drawnLatLngs.length >= this.MIN_VERTEX && this.CLOSED) {
            commit = true;  // Allow to close on first point also for polygons
        } else {
            this.onVertexRawMarkerClick(e);
        }
        // 🍂namespace Editable
        // 🍂section Vertex events
        // 🍂event editable:vertex:clicked: VertexEvent
        // Fired when a `click` is issued on a vertex, after all internal actions.
        this.fireAndForward('editable:vertex:clicked', e);
        if (commit) this.commitDrawing(e);
    },

    onVertexRawMarkerClick: function (e) {
        // 🍂namespace Editable
        // 🍂section Vertex events
        // 🍂event editable:vertex:rawclick: CancelableVertexEvent
        // Fired when a `click` is issued on a vertex without any special key and without being in drawing mode.
        this.fireAndForward('editable:vertex:rawclick', e);
        if (e._cancelled) return;
        if (!this.vertexCanBeDeleted(e.vertex)) return;
        e.vertex.delete();
    },

    vertexCanBeDeleted: function (vertex) {
        return vertex.latlngs.length > this.MIN_VERTEX;
    },

    onVertexDeleted: function (e) {
        // 🍂namespace Editable
        // 🍂section Vertex events
        // 🍂event editable:vertex:deleted: VertexEvent
        // Fired after a vertex has been deleted by user.
        this.fireAndForward('editable:vertex:deleted', e);
    },

    onVertexMarkerCtrlClick: function (e) {
        // 🍂namespace Editable
        // 🍂section Vertex events
        // 🍂event editable:vertex:ctrlclick: VertexEvent
        // Fired when a `click` with `ctrlKey` is issued on a vertex.
        this.fireAndForward('editable:vertex:ctrlclick', e);
    },

    onVertexMarkerShiftClick: function (e) {
        // 🍂namespace Editable
        // 🍂section Vertex events
        // 🍂event editable:vertex:shiftclick: VertexEvent
        // Fired when a `click` with `shiftKey` is issued on a vertex.
        this.fireAndForward('editable:vertex:shiftclick', e);
    },

    onVertexMarkerMetaKeyClick: function (e) {
        // 🍂namespace Editable
        // 🍂section Vertex events
        // 🍂event editable:vertex:metakeyclick: VertexEvent
        // Fired when a `click` with `metaKey` is issued on a vertex.
        this.fireAndForward('editable:vertex:metakeyclick', e);
    },

    onVertexMarkerAltClick: function (e) {
        // 🍂namespace Editable
        // 🍂section Vertex events
        // 🍂event editable:vertex:altclick: VertexEvent
        // Fired when a `click` with `altKey` is issued on a vertex.
        this.fireAndForward('editable:vertex:altclick', e);
    },

    onVertexMarkerContextMenu: function (e) {
        // 🍂namespace Editable
        // 🍂section Vertex events
        // 🍂event editable:vertex:contextmenu: VertexEvent
        // Fired when a `contextmenu` is issued on a vertex.
        this.fireAndForward('editable:vertex:contextmenu', e);
        this.commitDrawing(e);
    },

    onVertexMarkerMouseDown: function (e) {
        // 🍂namespace Editable
        // 🍂section Vertex events
        // 🍂event editable:vertex:mousedown: VertexEvent
        // Fired when user `mousedown` a vertex.
        this.fireAndForward('editable:vertex:mousedown', e);
    },

    onMiddleMarkerMouseDown: function (e) {
        // 🍂namespace Editable
        // 🍂section MiddleMarker events
        // 🍂event editable:middlemarker:mousedown: VertexEvent
        // Fired when user `mousedown` a middle marker.
        this.fireAndForward('editable:middlemarker:mousedown', e);
    },

    onVertexMarkerDrag: function (e) {
        this.onMove(e);
        if (this.feature._bounds) this.extendBounds(e);
        // 🍂namespace Editable
        // 🍂section Vertex events
        // 🍂event editable:vertex:drag: VertexEvent
        // Fired when a vertex is dragged by user.
        this.fireAndForward('editable:vertex:drag', e);
    },

    onVertexMarkerDragStart: function (e) {
        // 🍂namespace Editable
        // 🍂section Vertex events
        // 🍂event editable:vertex:dragstart: VertexEvent
        // Fired before a vertex is dragged by user.
        this.fireAndForward('editable:vertex:dragstart', e);
    },

    onVertexMarkerDragEnd: function (e) {
        // 🍂namespace Editable
        // 🍂section Vertex events
        // 🍂event editable:vertex:dragend: VertexEvent
        // Fired after a vertex is dragged by user.
        this.fireAndForward('editable:vertex:dragend', e);
    },

    setDrawnLatLngs: function (latlngs) {
        this._drawnLatLngs = latlngs || this.getDefaultLatLngs();
    },

    startDrawing: function () {
        if (!this._drawnLatLngs) this.setDrawnLatLngs();
        LW.Editable.BaseEditor.prototype.startDrawing.call(this);
    },

    startDrawingForward: function () {
        this.startDrawing();
    },

    endDrawing: function () {
        this.tools.detachForwardLineGuide();
        this.tools.detachBackwardLineGuide();
        if (this._drawnLatLngs && this._drawnLatLngs.length < this.MIN_VERTEX) this.deleteShape(this._drawnLatLngs);
        LW.Editable.BaseEditor.prototype.endDrawing.call(this);
        delete this._drawnLatLngs;
    },

    addLatLng: function (latlng) {
        if (this._drawing === LW.Editable.FORWARD) this._drawnLatLngs.push(latlng);
        else this._drawnLatLngs.unshift(latlng);
        this.feature._bounds.extend(latlng);
        this.addVertexMarker(latlng, this._drawnLatLngs);
        this.refresh();
    },

    newPointForward: function (latlng) {
        this.addLatLng(latlng);
        this.tools.attachForwardLineGuide();
        this.tools.anchorForwardLineGuide(latlng);
    },

    newPointBackward: function (latlng) {
        this.addLatLng(latlng);
        this.tools.anchorBackwardLineGuide(latlng);
    },

    // 🍂namespace PathEditor
    // 🍂method push()
    // Programmatically add a point while drawing.
    push: function (latlng) {
        if (!latlng) return console.error('LW.Editable.PathEditor.push expect a vaild latlng as parameter');
        if (this._drawing === LW.Editable.FORWARD) this.newPointForward(latlng);
        else this.newPointBackward(latlng);
    },

    removeLatLng: function (latlng) {
        latlng.__vertex.delete();
        this.refresh();
    },

    // 🍂method pop(): L.LatLng or null
    // Programmatically remove last point (if any) while drawing.
    pop: function () {
        if (this._drawnLatLngs.length <= 1) return;
        var latlng;
        if (this._drawing === LW.Editable.FORWARD) latlng = this._drawnLatLngs[this._drawnLatLngs.length - 1];
        else latlng = this._drawnLatLngs[0];
        this.removeLatLng(latlng);
        if (this._drawing === LW.Editable.FORWARD) this.tools.anchorForwardLineGuide(this._drawnLatLngs[this._drawnLatLngs.length - 1]);
        else this.tools.anchorForwardLineGuide(this._drawnLatLngs[0]);
        return latlng;
    },

    processDrawingClick: function (e) {
        if (e.vertex && e.vertex.editor === this) return;
        if (this._drawing === LW.Editable.FORWARD) this.newPointForward(e.latlng);
        else this.newPointBackward(e.latlng);
        this.fireAndForward('editable:drawing:clicked', e);
    },

    onDrawingMouseMove: function (e) {
        LW.Editable.BaseEditor.prototype.onDrawingMouseMove.call(this, e);
        if (this._drawing) {
            this.tools.moveForwardLineGuide(e.latlng);
            this.tools.moveBackwardLineGuide(e.latlng);
        }
    },

    refresh: function () {
        this.feature.redraw();
        this.onEditing();
    },

    // 🍂namespace PathEditor
    // 🍂method newShape(latlng?: L.LatLng)
    // Add a new shape (Polyline, Polygon) in a multi, and setup up drawing tools to draw it;
    // if optional `latlng` is given, start a path at this point.
    newShape: function (latlng) {
        var shape = this.addNewEmptyShape();
        if (!shape) return;
        this.setDrawnLatLngs(shape[0] || shape);  // Polygon or polyline
        this.startDrawingForward();
        // 🍂namespace Editable
        // 🍂section Shape events
        // 🍂event editable:shape:new: ShapeEvent
        // Fired when a new shape is created in a multi (Polygon or Polyline).
        this.fireAndForward('editable:shape:new', {shape: shape});
        if (latlng) this.newPointForward(latlng);
    },

    deleteShape: function (shape, latlngs) {
        var e = {shape: shape};
        LW.Editable.makeCancellable(e);
        // 🍂namespace Editable
        // 🍂section Shape events
        // 🍂event editable:shape:delete: CancelableShapeEvent
        // Fired before a new shape is deleted in a multi (Polygon or Polyline).
        this.fireAndForward('editable:shape:delete', e);
        if (e._cancelled) return;
        shape = this._deleteShape(shape, latlngs);
        if (this.ensureNotFlat) this.ensureNotFlat();  // Polygon.
        this.feature.setLatLngs(this.getLatLngs());  // Force bounds reset.
        this.refresh();
        this.reset();
        // 🍂namespace Editable
        // 🍂section Shape events
        // 🍂event editable:shape:deleted: ShapeEvent
        // Fired after a new shape is deleted in a multi (Polygon or Polyline).
        this.fireAndForward('editable:shape:deleted', {shape: shape});
        return shape;
    },

    _deleteShape: function (shape, latlngs) {
        latlngs = latlngs || this.getLatLngs();
        if (!latlngs.length) return;
        var self = this,
            inplaceDelete = function (latlngs, shape) {
                // Called when deleting a flat latlngs
                shape = latlngs.splice(0, Number.MAX_VALUE);
                return shape;
            },
            spliceDelete = function (latlngs, shape) {
                // Called when removing a latlngs inside an array
                latlngs.splice(latlngs.indexOf(shape), 1);
                if (!latlngs.length) self._deleteShape(latlngs);
                return shape;
            };
        if (latlngs === shape) return inplaceDelete(latlngs, shape);
        for (var i = 0; i < latlngs.length; i++) {
            if (latlngs[i] === shape) return spliceDelete(latlngs, shape);
            else if (latlngs[i].indexOf(shape) !== -1) return spliceDelete(latlngs[i], shape);
        }
    },

    // 🍂namespace PathEditor
    // 🍂method deleteShapeAt(latlng: L.LatLng): Array
    // Remove a path shape at the given `latlng`.
    deleteShapeAt: function (latlng) {
        var shape = this.feature.shapeAt(latlng);
        if (shape) return this.deleteShape(shape);
    },

    // 🍂method appendShape(shape: Array)
    // Append a new shape to the Polygon or Polyline.
    appendShape: function (shape) {
        this.insertShape(shape);
    },

    // 🍂method prependShape(shape: Array)
    // Prepend a new shape to the Polygon or Polyline.
    prependShape: function (shape) {
        this.insertShape(shape, 0);
    },

    // 🍂method insertShape(shape: Array, index: int)
    // Insert a new shape to the Polygon or Polyline at given index (default is to append).
    insertShape: function (shape, index) {
        this.ensureMulti();
        shape = this.formatShape(shape);
        if (typeof index === 'undefined') index = this.feature._latlngs.length;
        this.feature._latlngs.splice(index, 0, shape);
        this.feature.redraw();
        if (this._enabled) this.reset();
    },

    extendBounds: function (e) {
        this.feature._bounds.extend(e.vertex.latlng);
    },

    onDragStart: function (e) {
        this.editLayer.clearLayers();
        LW.Editable.BaseEditor.prototype.onDragStart.call(this, e);
    },

    onDragEnd: function (e) {
        this.initVertexMarkers();
        LW.Editable.BaseEditor.prototype.onDragEnd.call(this, e);
    }

});

// 🍂namespace Editable; 🍂class PolylineEditor; 🍂aka LW.Editable.PolylineEditor
// 🍂inherits PathEditor
LW.Editable.PolylineEditor = LW.Editable.PathEditor.extend({

    startDrawingBackward: function () {
        this._drawing = LW.Editable.BACKWARD;
        this.startDrawing();
    },

    // 🍂method continueBackward(latlngs?: Array)
    // Set up drawing tools to continue the line backward.
    continueBackward: function (latlngs) {
        if (this.drawing()) return;
        latlngs = latlngs || this.getDefaultLatLngs();
        this.setDrawnLatLngs(latlngs);
        if (latlngs.length > 0) {
            this.tools.attachBackwardLineGuide();
            this.tools.anchorBackwardLineGuide(latlngs[0]);
        }
        this.startDrawingBackward();
    },

    // 🍂method continueForward(latlngs?: Array)
    // Set up drawing tools to continue the line forward.
    continueForward: function (latlngs) {
        if (this.drawing()) return;
        latlngs = latlngs || this.getDefaultLatLngs();
        this.setDrawnLatLngs(latlngs);
        if (latlngs.length > 0) {
            this.tools.attachForwardLineGuide();
            this.tools.anchorForwardLineGuide(latlngs[latlngs.length - 1]);
        }
        this.startDrawingForward();
    },

    getDefaultLatLngs: function (latlngs) {
        latlngs = latlngs || this.feature._latlngs;
        if (!latlngs.length || latlngs[0] instanceof L.LatLng) return latlngs;
        else return this.getDefaultLatLngs(latlngs[0]);
    },

    ensureMulti: function () {
        if (this.feature._latlngs.length && L.Polyline._flat(this.feature._latlngs)) {
            this.feature._latlngs = [this.feature._latlngs];
        }
    },

    addNewEmptyShape: function () {
        if (this.feature._latlngs.length) {
            var shape = [];
            this.appendShape(shape);
            return shape;
        } else {
            return this.feature._latlngs;
        }
    },

    formatShape: function (shape) {
        if (L.Polyline._flat(shape)) return shape;
        else if (shape[0]) return this.formatShape(shape[0]);
    },

    // 🍂method splitShape(latlngs?: Array, index: int)
    // Split the given `latlngs` shape at index `index` and integrate new shape in instance `latlngs`.
    splitShape: function (shape, index) {
        if (!index || index >= shape.length - 1) return;
        this.ensureMulti();
        var shapeIndex = this.feature._latlngs.indexOf(shape);
        if (shapeIndex === -1) return;
        var first = shape.slice(0, index + 1),
            second = shape.slice(index);
        // We deal with reference, we don't want twice the same latlng around.
        second[0] = L.latLng(second[0].lat, second[0].lng, second[0].alt);
        this.feature._latlngs.splice(shapeIndex, 1, first, second);
        this.refresh();
        this.reset();
    }

});

LW.Editable.ProfileLineEditor = LW.Editable.PolylineEditor.extend({
    addLatLng: function (latlng) {
        LW.Editable.PolylineEditor.prototype.addLatLng.call(this, latlng);
        if (this._drawnLatLngs.length > 1)
            this.commitDrawing();
    }
});

// 🍂namespace Editable; 🍂class PolygonEditor; 🍂aka LW.Editable.PolygonEditor
// 🍂inherits PathEditor
LW.Editable.PolygonEditor = LW.Editable.PathEditor.extend({

    CLOSED: true,
    MIN_VERTEX: 3,

    newPointForward: function (latlng) {
        LW.Editable.PathEditor.prototype.newPointForward.call(this, latlng);
        if (!this.tools.backwardLineGuide._latlngs.length) this.tools.anchorBackwardLineGuide(latlng);
        if (this._drawnLatLngs.length === 2) this.tools.attachBackwardLineGuide();
    },

    addNewEmptyHole: function (latlng) {
        this.ensureNotFlat();
        var latlngs = this.feature.shapeAt(latlng);
        if (!latlngs) return;
        var holes = [];
        latlngs.push(holes);
        return holes;
    },

    // 🍂method newHole(latlng?: L.LatLng, index: int)
    // Set up drawing tools for creating a new hole on the Polygon. If the `latlng` param is given, a first point is created.
    newHole: function (latlng) {
        var holes = this.addNewEmptyHole(latlng);
        if (!holes) return;
        this.setDrawnLatLngs(holes);
        this.startDrawingForward();
        if (latlng) this.newPointForward(latlng);
    },

    addNewEmptyShape: function () {
        if (this.feature._latlngs.length && this.feature._latlngs[0].length) {
            var shape = [];
            this.appendShape(shape);
            return shape;
        } else {
            return this.feature._latlngs;
        }
    },

    ensureMulti: function () {
        if (this.feature._latlngs.length && L.Polyline._flat(this.feature._latlngs[0])) {
            this.feature._latlngs = [this.feature._latlngs];
        }
    },

    ensureNotFlat: function () {
        if (!this.feature._latlngs.length || L.Polyline._flat(this.feature._latlngs)) this.feature._latlngs = [this.feature._latlngs];
    },

    vertexCanBeDeleted: function (vertex) {
        var parent = this.feature.parentShape(vertex.latlngs),
            idx = L.Util.indexOf(parent, vertex.latlngs);
        if (idx > 0) return true;  // Holes can be totally deleted without removing the layer itself.
        return LW.Editable.PathEditor.prototype.vertexCanBeDeleted.call(this, vertex);
    },

    getDefaultLatLngs: function () {
        if (!this.feature._latlngs.length) this.feature._latlngs.push([]);
        return this.feature._latlngs[0];
    },

    formatShape: function (shape) {
        // [[1, 2], [3, 4]] => must be nested
        // [] => must be nested
        // [[]] => is already nested
        if (L.Polyline._flat(shape) && (!shape[0] || shape[0].length !== 0)) return [shape];
        else return shape;
    }

});

// 🍂namespace Editable; 🍂class RectangleEditor; 🍂aka LW.Editable.RectangleEditor
// 🍂inherits PathEditor
LW.Editable.RectangleEditor = LW.Editable.PathEditor.extend({

    CLOSED: true,
    MIN_VERTEX: 4,

    options: {
        skipMiddleMarkers: true
    },

    extendBounds: function (e) {
        var index = e.vertex.getIndex(),
            next = e.vertex.getNext(),
            previous = e.vertex.getPrevious(),
            oppositeIndex = (index + 2) % 4,
            opposite = e.vertex.latlngs[oppositeIndex],
            bounds = new L.LatLngBounds(e.latlng, opposite);
        // Update latlngs by hand to preserve order.
        previous.latlng.update([e.latlng.lat, opposite.lng]);
        next.latlng.update([opposite.lat, e.latlng.lng]);
        this.updateBounds(bounds);
        this.refreshVertexMarkers();
    },

    onDrawingMouseDown: function (e) {
        LW.Editable.PathEditor.prototype.onDrawingMouseDown.call(this, e);
        this.connect();
        var latlngs = this.getDefaultLatLngs();
        // L.Polygon._convertLatLngs removes last latlng if it equals first point,
        // which is the case here as all latlngs are [0, 0]
        if (latlngs.length === 3) latlngs.push(e.latlng);
        var bounds = new L.LatLngBounds(e.latlng, e.latlng);
        this.updateBounds(bounds);
        this.updateLatLngs(bounds);
        this.refresh();
        this.reset();
        // Stop dragging map.
        // L.Draggable has two workflows:
        // - mousedown => mousemove => mouseup
        // - touchstart => touchmove => touchend
        // Problem: L.Map.Tap does not allow us to listen to touchstart, so we only
        // can deal with mousedown, but then when in a touch device, we are dealing with
        // simulated events (actually simulated by L.Map.Tap), which are no more taken
        // into account by L.Draggable.
        // Ref.: https://github.com/Leaflet/Leaflet.Editable/issues/103
        e.originalEvent._simulated = false;
        this.map.dragging._draggable._onUp(e.originalEvent);
        // Now transfer ongoing drag action to the bottom right corner.
        // Should we refine which corne will handle the drag according to
        // drag direction?
        latlngs[3].__vertex.dragging._draggable._onDown(e.originalEvent);
    },

    onDrawingMouseUp: function (e) {
        this.commitDrawing(e);
        e.originalEvent._simulated = false;
        LW.Editable.PathEditor.prototype.onDrawingMouseUp.call(this, e);
    },

    onDrawingMouseMove: function (e) {
        e.originalEvent._simulated = false;
        LW.Editable.PathEditor.prototype.onDrawingMouseMove.call(this, e);
    },


    getDefaultLatLngs: function (latlngs) {
        return latlngs || this.feature._latlngs[0];
    },

    updateBounds: function (bounds) {
        this.feature._bounds = bounds;
    },

    updateLatLngs: function (bounds) {
        var latlngs = this.getDefaultLatLngs(),
            newLatlngs = this.feature._boundsToLatLngs(bounds);
        // Keep references.
        for (var i = 0; i < latlngs.length; i++) {
            latlngs[i].update(newLatlngs[i]);
        }
        ;
    }

});

// 🍂namespace Editable; 🍂class CircleEditor; 🍂aka LW.Editable.CircleEditor
// 🍂inherits PathEditor
LW.Editable.CircleEditor = LW.Editable.PathEditor.extend({

    MIN_VERTEX: 2,

    options: {
        skipMiddleMarkers: true
    },

    initialize: function (map, feature, options) {
        LW.Editable.PathEditor.prototype.initialize.call(this, map, feature, options);
        this._resizeLatLng = this.computeResizeLatLng();
    },

    computeResizeLatLng: function () {
        // While circle is not added to the map, _radius is not set.
        var delta = (this.feature._radius || this.feature._mRadius) * Math.cos(Math.PI / 4),
            point = this.map.project(this.feature._latlng);
        return this.map.unproject([point.x + delta, point.y - delta]);
    },

    updateResizeLatLng: function () {
        this._resizeLatLng.update(this.computeResizeLatLng());
        this._resizeLatLng.__vertex.update();
    },

    getLatLngs: function () {
        return [this.feature._latlng, this._resizeLatLng];
    },

    getDefaultLatLngs: function () {
        return this.getLatLngs();
    },

    onVertexMarkerDrag: function (e) {
        if (e.vertex.getIndex() === 1) this.resize(e);
        else this.updateResizeLatLng(e);
        LW.Editable.PathEditor.prototype.onVertexMarkerDrag.call(this, e);
    },

    resize: function (e) {
        var radius = this.feature._latlng.distanceTo(e.latlng)
        this.feature.setRadius(radius);
    },

    onDrawingMouseDown: function (e) {
        LW.Editable.PathEditor.prototype.onDrawingMouseDown.call(this, e);
        this._resizeLatLng.update(e.latlng);
        this.feature._latlng.update(e.latlng);
        this.connect();
        // Stop dragging map.
        e.originalEvent._simulated = false;
        this.map.dragging._draggable._onUp(e.originalEvent);
        // Now transfer ongoing drag action to the radius handler.
        this._resizeLatLng.__vertex.dragging._draggable._onDown(e.originalEvent);
    },

    onDrawingMouseUp: function (e) {
        this.commitDrawing(e);
        e.originalEvent._simulated = false;
        LW.Editable.PathEditor.prototype.onDrawingMouseUp.call(this, e);
    },

    onDrawingMouseMove: function (e) {
        e.originalEvent._simulated = false;
        LW.Editable.PathEditor.prototype.onDrawingMouseMove.call(this, e);
    },

    onDrag: function (e) {
        LW.Editable.PathEditor.prototype.onDrag.call(this, e);
        this.feature.dragging.updateLatLng(this._resizeLatLng);
    }

});

// 🍂namespace Editable; 🍂class EditableMixin
// `EditableMixin` is included to `L.Polyline`, `L.Polygon`, `L.Rectangle`, `L.Circle`
// and `L.Marker`. It adds some methods to them.
// *When editing is enabled, the editor is accessible on the instance with the
// `editor` property.*
var EditableMixin = {

    createEditor: function (map) {
        map = map || this._map;
        var tools = (this.options.editOptions || {}).editTools || map.editTools;
        if (!tools) throw Error('Unable to detect Editable instance.')
        var Klass = this.options.editorClass || this.getEditorClass(tools);
        return new Klass(map, this, this.options.editOptions);
    },

    // 🍂method enableEdit(map?: L.Map): this.editor
    // Enable editing, by creating an editor if not existing, and then calling `enable` on it.
    enableEdit: function (map) {
        if (!this.editor) this.createEditor(map);
        this.editor.enable();
        return this.editor;
    },

    // 🍂method editEnabled(): boolean
    // Return true if current instance has an editor attached, and this editor is enabled.
    editEnabled: function () {
        return this.editor && this.editor.enabled();
    },

    // 🍂method disableEdit()
    // Disable editing, also remove the editor property reference.
    disableEdit: function () {
        if (this.editor) {
            this.editor.disable();
            delete this.editor;
        }
    },

    // 🍂method toggleEdit()
    // Enable or disable editing, according to current status.
    toggleEdit: function () {
        if (this.editEnabled()) this.disableEdit();
        else this.enableEdit();
    },

    _onEditableAdd: function () {
        if (this.editor) this.enableEdit();
    }

};

var PolylineMixin = {

    getEditorClass: function (tools) {
        var editClass = this.options.profileLine ? LW.Editable.ProfileLineEditor : LW.Editable.PolylineEditor;
        return (tools && tools.options.polylineEditorClass) ? tools.options.polylineEditorClass : editClass;
    },

    shapeAt: function (latlng, latlngs) {
        // We can have those cases:
        // - latlngs are just a flat array of latlngs, use this
        // - latlngs is an array of arrays of latlngs, loop over
        var shape = null;
        latlngs = latlngs || this._latlngs;
        if (!latlngs.length) return shape;
        else if (L.Polyline._flat(latlngs) && this.isInLatLngs(latlng, latlngs)) shape = latlngs;
        else for (var i = 0; i < latlngs.length; i++) if (this.isInLatLngs(latlng, latlngs[i])) return latlngs[i];
        return shape;
    },

    isInLatLngs: function (l, latlngs) {
        if (!latlngs) return false;
        var i, k, len, part = [], p,
            w = this._clickTolerance();
        this._projectLatlngs(latlngs, part, this._pxBounds);
        part = part[0];
        p = this._map.latLngToLayerPoint(l);

        if (!this._pxBounds.contains(p)) {
            return false;
        }
        for (i = 1, len = part.length, k = 0; i < len; k = i++) {

            if (L.LineUtil.pointToSegmentDistance(p, part[k], part[i]) <= w) {
                return true;
            }
        }
        return false;
    }

};

var PolygonMixin = {

    getEditorClass: function (tools) {
        return (tools && tools.options.polygonEditorClass) ? tools.options.polygonEditorClass : LW.Editable.PolygonEditor;
    },

    shapeAt: function (latlng, latlngs) {
        // We can have those cases:
        // - latlngs are just a flat array of latlngs, use this
        // - latlngs is an array of arrays of latlngs, this is a simple polygon (maybe with holes), use the first
        // - latlngs is an array of arrays of arrays, this is a multi, loop over
        var shape = null;
        latlngs = latlngs || this._latlngs;
        if (!latlngs.length) return shape;
        else if (L.Polyline._flat(latlngs) && this.isInLatLngs(latlng, latlngs)) shape = latlngs;
        else if (L.Polyline._flat(latlngs[0]) && this.isInLatLngs(latlng, latlngs[0])) shape = latlngs;
        else for (var i = 0; i < latlngs.length; i++) if (this.isInLatLngs(latlng, latlngs[i][0])) return latlngs[i];
        return shape;
    },

    isInLatLngs: function (l, latlngs) {
        var inside = false, l1, l2, j, k, len2;

        for (j = 0, len2 = latlngs.length, k = len2 - 1; j < len2; k = j++) {
            l1 = latlngs[j];
            l2 = latlngs[k];

            if (((l1.lat > l.lat) !== (l2.lat > l.lat)) &&
                (l.lng < (l2.lng - l1.lng) * (l.lat - l1.lat) / (l2.lat - l1.lat) + l1.lng)) {
                inside = !inside;
            }
        }

        return inside;
    },

    parentShape: function (shape, latlngs) {
        latlngs = latlngs || this._latlngs;
        if (!latlngs) return;
        var idx = L.Util.indexOf(latlngs, shape);
        if (idx !== -1) return latlngs;
        for (var i = 0; i < latlngs.length; i++) {
            idx = L.Util.indexOf(latlngs[i], shape);
            if (idx !== -1) return latlngs[i];
        }
    }

};


var MarkerMixin = {

    getEditorClass: function (tools) {
        return (tools && tools.options.markerEditorClass) ? tools.options.markerEditorClass : LW.Editable.MarkerEditor;
    }

};

var RectangleMixin = {

    getEditorClass: function (tools) {
        return (tools && tools.options.rectangleEditorClass) ? tools.options.rectangleEditorClass : LW.Editable.RectangleEditor;
    }

};

var CircleMixin = {

    getEditorClass: function (tools) {
        return (tools && tools.options.circleEditorClass) ? tools.options.circleEditorClass : LW.Editable.CircleEditor;
    }

};

var keepEditable = function () {
    // Make sure you can remove/readd an editable layer.
    this.on('add', this._onEditableAdd);
};


if (L.Polyline) {
    L.Polyline.include(EditableMixin);
    L.Polyline.include(PolylineMixin);
    L.Polyline.addInitHook(keepEditable);
}
if (L.Polygon) {
    L.Polygon.include(EditableMixin);
    L.Polygon.include(PolygonMixin);
}
if (L.Marker) {
    L.Marker.include(EditableMixin);
    L.Marker.include(MarkerMixin);
    L.Marker.addInitHook(keepEditable);
}
if (L.Rectangle) {
    L.Rectangle.include(EditableMixin);
    L.Rectangle.include(RectangleMixin);
}
if (L.Circle) {
    L.Circle.include(EditableMixin);
    L.Circle.include(CircleMixin);
}

L.LatLng.prototype.update = function (latlng) {
    latlng = L.latLng(latlng);
    this.lat = latlng.lat;
    this.lng = latlng.lng;
};

/**
 * 地图相关
 *
 * Features :
 *      1. 含地图联动
 *      2. 含地图控制器、测距、标注等显示与control位的工具
 *
 * @module Map
 */

/**
 * 地图切换工具
 *
 * Features :
 *      1. 需引用font-awesome.css
 *      2. 会直接显示于放大缩小控制按钮之下
 *
 * @class L.Control.MapSwitchTool
 * @extends L.Control.Zoom
 */
L.Control.MapSwitchTool = L.Control.Zoom.extend({
    options: {
        /**
         * 瓦片图层
         * @property baseTile
         * @type {L.TileLayer}
         * @default null
         */
        baseTile: null,
        /**
         * 默认瓦片图地址
         * @property baseTileUrl
         * @type {string}
         * @default ''
         */
        baseTileUrl: '',
        /**
         * 切换瓦片图地址
         * @property alternateTileUrl
         * @type {string}
         * @default ''
         */
        alternateTileUrl: ''
    },

    _isBaseTileUrl: true,

    onAdd: function (map) {
        var container = map.zoomControl ? map.zoomControl._container : L.DomUtil.create('div', 'leaflet-bar');
        this._createButton('', '切换地图', 'icon-globe', container, this._switchMap);
        return container;
    },

    _switchMap: function () {
        if (this.options.baseTile instanceof L.TileLayer)
            this.options.baseTile.setUrl(this._isBaseTileUrl ? this.options.alternateTileUrl : this.options.baseTileUrl);
        this._isBaseTileUrl = !this._isBaseTileUrl;
    }
});

L.control.mapSwitchTool = function (options) {
    return new L.Control.MapSwitchTool(options);
};


/**
 * 工具栏
 *
 * Features :
 *      1. 需引用font-awesome.css
 *      2. 显示于放大缩小控制按钮的下一行
 *      3. 含测距、标记、删除标记等功能
 *
 * @class L.Control.Tool
 * @extends L.Control
 * @demo demo/edit/mapTool.html  {地图工具}
 */
L.Control.Tool = L.Control.extend({
    options: {
        position: 'topleft'
    },

    onAdd: function (map) {
        var container = L.DomUtil.create('div', 'leaflet-control leaflet-bar'),
            measure = this._createIcon('icon-magic', container, '测距,点击最后一点结束测距'),
            mark = this._createIcon('icon-map-marker icon-large', container, '标记'),
            trash = this._createIcon('icon-trash icon-large', container, '删除'),
            ban = this._createIcon('icon-ban-circle', container, '取消');

        var offDelete = function () {
            trash.style.color = '#000';
            map.eachLayer(function (layer) {
                if (layer.offClickDelete)
                    layer.offClickDelete();
            })
        };
        L.DomEvent.on(measure, 'click', function () {
            offDelete();
            map.editTools.startMeasure();
        });
        L.DomEvent.on(mark, 'click', function () {
            offDelete();
            map.editTools.startMarker();
        });
        L.DomEvent.on(trash, 'click', function () {
            this.style.color = '#c83025';
            ban.style.color = '#000';
            map.eachLayer(function (layer) {
                if (layer.onClickDelete)
                    layer.onClickDelete();
            });
        });
        L.DomEvent.on(ban, 'click', function () {
            offDelete();
        });
        return container;
    },

    _createIcon: function (className, container, title) {
        var link = L.DomUtil.create('a', className, container);
        link.href = '#';
        link.title = title;
        return link;
    }
});

/**
 * @class L.Control.Tool
 * @constructor
 * @param options {object} 外部属性，可重设Properties
 * @returns {L.Control.Tool}
 */
L.control.tool = function (options) {
    return new L.Control.Tool(options);
};


/**
 * 可测距的Editable
 */

LW.EditableWithMeasure = LW.Editable.extend({
    options: {
        measureLineClass: LW.MeasureLine
    },

    startMeasure: function (latlng,options) {
        var line = this.createMeasureline([],options);
        this.connectCreatedToMap(line);
        line.enableEdit().newShape(latlng);
        return line;
    },

    createMeasureline: function (latlngs,options) {
        options = L.Util.extend({editOptions: {editTools: this}}, options);
        var line = new this.options.measureLineClass(latlngs, options);
        this.fireAndForward('editable:created', {layer: line});
        return line;
    }
});

LW.Editable.LabelPolylineEditor = LW.Editable.PolylineEditor.extend({
    addVertexMarker: function (latlng, latlngs) {
        return new this.tools.options.vertexMarkerClass(latlng, latlngs, this,
            {draggable: false,className: 'lw-vertex-icon leaflet-vertex-icon',iconSize:L.point(6,6)});
    }
});

L.Map.mergeOptions({
    editToolsClass: LW.EditableWithMeasure
});

/**
 * @module Layer.Edit
 */

/**
 * 套索工具
 *
 * Features :
 *      1. 支持Marker图层的圈选
 *      2. 支持边界图层的圈选
 *
 * @class LW.LassoTool
 * @extends L.Evented
 * @demo demo/edit/lassoTool_marker.html  {marker点圈选}
 * @demo demo/edit/lassoTool_cslayer.html  {cs Marker点圈选}
 * @demo demo/edit/lassoTool_polygon.html  {区界圈选}
 */
LW.LassoTool = L.Evented.extend({
    options: {
        weight: 1,
        gridChosenType:'value',//value/index
        pane: 'boundaryPane'
    },

    initialize: function (map, chosenLayer, options) {
        L.setOptions(this, options);
        this._map = map;
        this._chosenLayer = chosenLayer;
        this._lassoLayer = L.polygon([], this.options);
    },

    /**
     * 设置被圈选图层
     * @method setChosenLayer
     * @param chosenLayer {L.Layer} 被圈选图层
     */
    setChosenLayer: function (chosenLayer) {
        this._chosenLayer = chosenLayer;
    },

    /**
     * 圈选开始
     * @method lassoStart
     */
    lassoStart: function () {
        this._map.dragging.disable();
        if (!this._map.hasLayer(this._lassoLayer))
            this._map.addLayer(this._lassoLayer);
        this._map.on("mousedown", this._onDown, this);
        this._map.on("mouseup", this._onUp, this);
    },

    /**
     * 圈选结束
     * @method lassoEnd
     */
    lassoEnd: function () {
        this._map.dragging.enable();
        this._map.removeLayer(this._lassoLayer);
        this._map.off("mousedown", this._onDown, this);
        this._map.off("mouseup", this._onUp, this);
        this._lassoLayer.setLatLngs([]);
    },

    /**
     * 获取起止经纬度
     * @method getLatLngs
     * @returns {*}
     */
    getLatLngs: function () {
        return this._lassoLayer.getLatLngs();
    },

    _onDown: function (e) {
        this._drawing = true;
        this._trackData = [];
        this._map.on("mousemove", this._onMove, this);
    },

    _onMove: function (e) {
        if (this._drawing) {
            this._trackData.push(e.latlng);
            this._lassoLayer.setLatLngs(this._trackData);
            // Tip: 由于在div中做套索的操作就会触发click事件，csLayer在圈选结束就被侦听到click。所以将pointerEvents设置为'none',圈选结束恢复
            this._map._mapPane.style.pointerEvents = 'none';
        }
    },

    _onUp: function (e) {
        this._map._mapPane.style.pointerEvents = '';
        this._map.off("mousemove", this._onMove, this);
        this._drawing = false;
        this._lassoComplete();
    },

    _lassoComplete: function () {
        if (this._chosenLayer) {

            var chosen = [], i, j, k;

            // 图层集
            if(this._lassoLayer._latlngs[0].length>2){
                if (this._chosenLayer instanceof L.LayerGroup || (LW.CsBaseLayer && this._chosenLayer instanceof LW.CsBaseLayer)) {
                    var bounds = this._lassoLayer.getBounds();
                    if (bounds.isValid()) {
                        var layers = this._chosenLayer.getLayers(bounds);
                        if (layers) {
                            for (i = 0; i < layers.length; i++) {
                                var layer = layers[i];
                                layer = this._chosenLayer instanceof L.LayerGroup ? layer : layer.data;

                                // base layer
                                if (layer.getLatLng) {
                                    if (Sun.Util.Geometry.latlngInPolygon(layer.getLatLng(), this._trackData))
                                        chosen.push(layer);
                                }

                                // geoJson
                                else if (layer instanceof L.Polygon) {
                                    var latlngsArr = layer.getLatLngs();
                                    var beChosen = false;
                                    for (k = 0; k < latlngsArr.length; k++) {
                                        var latlngs = latlngsArr[k];
                                        latlngs = latlngs[0] instanceof L.LatLng ? latlngs : latlngs[0];
                                        if (layer._pxBounds.intersects(this._lassoLayer._pxBounds)) {
                                            for (j = 0; j < latlngs.length; j++) {
                                                if (Sun.Util.Geometry.latlngInPolygon(latlngs[j], this._trackData)) {
                                                    chosen.push(layer);
                                                    beChosen = true;
                                                    break;
                                                }
                                            }
                                            if (!beChosen) {
                                                for (j = 0; j < this._trackData.length; j++) {
                                                    if (Sun.Util.Geometry.latlngInPolygon(this._trackData[j], latlngs)) {
                                                        chosen.push(layer);
                                                        beChosen = true;
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                        if (beChosen) break;
                                    }
                                }
                            }
                        }
                    }
                }
                // 网格图层
                else if (this._chosenLayer instanceof LW.GridModel) {
                    chosen = Sun.Util.Geometry.getGridsInPolygon(this._chosenLayer.data, this._chosenLayer.grid,
                        this._trackData, this.options.gridChosenType);
                }

                if (chosen.length > 0)
                    this.fire('chosenComplete', {data: chosen});
            }
        }
        else
            this.fire('chosenComplete');
    }
});

/**
 * @class LW.LassoTool
 * @constructor
 * @param map {L.Map} 地图
 * @param chosenLayer {L.Layer} 被圈选图层
 * @param options {object} 外部属性，可重设Properties
 *                         注：此属性与L.Polygon属性一致
 * @returns {LW.LassoTool}
 */
LW.lassoTool = function (map, chosenLayer, options) {
    return new LW.LassoTool(map, chosenLayer, options);
};

/**
 * @module Layer.Plot.Profile
 */

/**
 * 剖面
 *
 * Features :
 *      1. 剖面基础图层
 *      2. 基于本图层扩展了数值预报剖面图层及雷达剖面图层
 *
 * @class LW.Profile
 * @extends L.Class
 */

LW.Profile = L.Class.extend({
    options: {
        /**
         * 剖面的css class
         * @property className
         * @type {string}
         * @default 'lw-profile'
         */
        className: 'lw-profile',

        /**
         * 剖面长度（单位：px）
         * @property width
         * @type {number}
         * @default 700
         */
        width: 700,

        /**
         * 剖面宽度（单位：px）
         * @property height
         * @type {number}
         * @default 500
         */
        height: 500,

        /**
         * 剖面外边距，可以调整剖面与外容器上下左右的距离
         * @property margins
         * @type {object}
         * @default {top: 30,right: 50,bottom: 30,left: 60}
         */
        margins: {
            top: 30,
            right: 40,
            bottom: 30,
            left: 50
        },

        /**
         * 是否显示坐标轴
         */
        axis:true,

        /**
         * x轴单位
         * @property xUnit
         * @type {string}
         * @default ''
         */
        xUnit: '',

        /**
         * x轴单位位置
         * @property xUnitP
         * @type {string}
         * @default {x: 50,y: 20}
         */
        xUnitP: {
            x: 50,
            y: 20
        },

        /**
         * y轴单位
         * @property yUnit
         * @type {string}
         * @default '(hPa)'
         */
        yUnit: '(hPa)',

        /**
         * y轴2的单位
         * @property yUnit2
         * @type {string}
         * @default '(km)'
         */
        yUnit2: '(km)'
        //cssUrl: 'Script/HW.BusinessGisLib/layer/plot/profile/profile.css'
    },

    initialize: function (panelContainer, map , options) {
        this._map = map;
        L.setOptions(this, options);
        // 展示初始化
        var pContainer = document.getElementById(panelContainer);
        this.container = L.DomUtil.create("div", this.options.className);
        pContainer.appendChild(this.container);
        this._initialShow();
    },

    _initialShow: function () {
        // 引用样式表
        //CommonUtil.createCssLink(this.options.cssUrl);

        // svg
        var opts = this.options;
        this.cont = d3.select(this.container);
        // this.cont.attr("width", opts.width);
        // this.cont.attr("height", opts.height);
        var svg = this.cont.append("svg");
        svg.attr("width", opts.width)
            .attr("height", opts.height)
            .append("g")
            .attr("transform", "translate(" + opts.margins.left + "," + opts.margins.top + ")");

        var g = this.g = d3.select(this.container).select("svg").select("g");
        // axis
        if(opts.axis){
            this._xaxisgraphicnode = g.append("g");
            this._yaxisgraphicnode = g.append("g");
            this._y2axisgraphicnode = g.append("g");
        }
    },

    _getxScale: function () {
        var _x = d3.scale.linear()
            .domain(this.data.xaxis)
            .range([0, this._width()]);

        return d3.svg.axis()
            .scale(_x)
            .orient("bottom")
    },

    _getyScale: function () {
        var _y = d3.scale.ordinal()
            .domain(this.data.yaxis)
            .rangePoints([0, this._height()]);

        return d3.svg.axis()
            .scale(_y)
            .orient("left")
    },

    _setXYTick: function () {
        this._xTick = (this._width() - 2) / (this.data.xaxis.length - 1);
        this._yTick = (this._height() - 1) / (this.data.yaxis.length - 1);
    },

    /**
     * 设置数据并绘制
     * @method setData
     * @param data {Array}
     */
    setData: function (data) {
        this.data = data;

        // x y tick
        this._setXYTick();

        if(this.options.axis)
            this._updateAxis();
    },

    _width: function () {
        var opts = this.options;
        return opts.width - opts.margins.left - opts.margins.right;
    },

    _height: function () {
        var opts = this.options;
        return opts.height - opts.margins.top - opts.margins.bottom;
    },

    _clearSvgNode: function (node) {
        node.selectAll("g").remove();
        node.selectAll("path").remove();
        node.selectAll("circle").remove();
        node.selectAll("text").remove();
    },

    _updateAxis: function () {
        this._clearSvgNode(this._xaxisgraphicnode);
        this._appendXaxis(this._xaxisgraphicnode);
        this._clearSvgNode(this._yaxisgraphicnode);
        this._appendYaxis(this._yaxisgraphicnode);
        this._clearSvgNode(this._y2axisgraphicnode);
        this._appendYaxis2(this._y2axisgraphicnode);
    },

    _appendXaxis: function (x) {
        x.attr("class", "x axis")
            .attr("transform", "translate(0," + this._height() + ")")
            .call(this._getxScale())
            .append("text")
            .attr("x", this._width() + this.options.xUnitP.x)
            .attr("y", this.options.xUnitP.y)
            .style("text-anchor", "end")
            .text(this.options.xUnit);
    },

    _appendYaxis: function (y) {
        y.attr("class", "y axis")
            .call(this._getyScale())
            .append("text")
            .attr("x", 0)
            .attr("y", -15)
            .style("text-anchor", "end")
            .text(this.options.yUnit);
    },

    _appendYaxis2: function (y) {
        return L.Util.falseFn;
    }
});

/**
 * 剖面相关
 * @module Layer.Plot.Profile
 */

/**
 * 剖面编辑
 *
 * Features :
 *      1. 在地图上点选两点，用于空间剖面
 *      2. 可拖动起始点，改变剖面位置
 *      3. map 的 editable 属性必须设置为true
 *
 * @class LW.Profile.Editable
 * @extends L.Evented
 */

LW.Profile.Editable = L.Evented.extend({
    options: {},

    initialize: function (map, options) {
        this.map = map;
        map.options.editToolsClass = LW.EditableWithMeasure;

        var self = this;
        map.on('editable:drawing:end', function (e) {
            if(e.layer.options.profileLine)
                self._endProfile(e.layer.getLatLngs())
        });
        map.on('editable:vertex:dragend', function (e) {
            if(e.layer.options.profileLine)
                self._endProfile(e.layer.getLatLngs())
        });
    },

    /**
     * 空间剖面方法--开始剖面
     * @method startProfile
     */
    startProfile: function (options) {
        this.map.editTools.startProfileline(null,options);
    },

    _endProfile: function (latlngs) {
        this.fire('editable:profile:end', {data: latlngs});
    },

    /**
     * 空间剖面方法--清除剖面辅助线
     * @method startProfile
     */
    clear: function () {
        this.map.editTools.forwardLineGuide.setLatLngs([]);
        this.map.editTools.featuresLayer.clearLayers();
    },

    /**
     * 空间剖面方法--重置剖面
     * @method startProfile
     */
    reset: function () {
        this.clear();
        this.startProfile();
    }
});

/**
 * @module Layer.Plot.Profile
 */

/**
 * 数值预报时间剖面
 *
 * Features :
 *      1. 该剖面为时间剖面，有表意明确的x轴
 *      2. 需引用d3.js
 *
 * Update Note：
 *      + v1.0.0 ：Created
 *      + v1.4.4 ：1. 将数据改为版本3.0 的nc数据，并自主跟踪填色，生成可用的色斑图和等值线数据
 *                 2. 增加各个要素可以控制显隐的功能
 *      + v1.5.1 ：增加hpa网格的数据源的支持，需要将options.yAxisType设为hpa
 *
 * @class LW.Profile.Isoline
 * @extends LW.Profile
 * @demo demo/plot/profile/profileIsoline_only.html  {数值预报剖面}
 * @demo demo/plot/profile/profileIsoline.html  {时间剖面}
 * @demo demo/plot/profile/profileIsoline_space.html  {空间剖面}
 */

/**
 * @class LW.Profile.Isoline
 * @constructor
 * @param panelContainer {string} 面板容器 style="position: absolute;"
 * @param map {L.Map} 地图
 * @param options {object} 外部属性，可重设Properties
 * @returns {LW.Profile.Isoline}
 */

LW.Profile.Isoline = LW.Profile.extend({
    options: {
        /**
         * 配置不同种类要素的配色方案
         *
         * Elements :
         *      1. grid: 仅支持一个格点值图层，可配置值颜色
         *      2. fill: 仅支持一个填色图层，根据配置的图例生成色斑图
         *      3. stroke: 支持多个等值线图层，需指定每个要素对应的线条颜色，需与数据相对应
         *      4. 要素名称需和数据中相对应，数据要素改变这里的要素也许做相应变化
         *
         * @property elements
         * @type {object}
         * @default {
         *        grid: {uv: {color: '#042499'}},
         *        fill: {key:'rh',legendData: Sun.LegendData.rh},
         *        stroke: {
         *            w: {color: '#333',gap:0.1},
         *            tt: {color: '#BD4F58',gap:4}
         *        }
         *    }
         */
        elements: {
            grid: {uv: {color: '#042499'}},
            fill: {key:'rh',legendData: Sun.LegendData.rh,opacity:1},
            stroke: {
                w: {color: '#333',gap:0.1},
                tt: {color: '#BD4F58',gap:4}
            }
        },
        xTick:1,
        /**
         * x轴类型,可选：hour/minute
         * @type {string}
         * @default 'hour'
         */
        xAxisType:'hour',
        xAxisOrient:'bottom',
        /**
         * x轴时间格式
         * @type {string}
         * @default 'ddhh'
         */
        timeFormat:'ddhh',

        /**
         * y轴类型。
         *      1. hap_km：双y轴，有hpa和km,数据以km的单位网格分布
         *      2. hpa：单y轴，数据以hpa的单位网格分布
         */
        yAxisType:'hpa_km',

        dataType:'nc'
    },

    _initialShow: function () {
        LW.Profile.prototype._initialShow.call(this);

        //isoline svg group
        this._setMask();
        var maskId = 'url(#profile-mask'+this.id+')';
        var elements = this.options.elements, g = this.g;
        this.g_isoline = {};
        if(elements.fill)
            this.g_isoline[elements.fill.key] = g.append("g").attr('clip-path',maskId);
        for(var key in elements.stroke){
            this.g_isoline[key]= g.append("g").attr('clip-path',maskId);
        }

        // 指示线 group
        this.g_indicator= {};

        //grid canvas
        if(this.options.elements.grid){
            var canvas = this.canvas = this.cont.append("canvas");
            canvas.attr("width", this._width())
                .attr("height", this._height() + this.options.margins.top)
                .style("position", "absolute")
                .style("top", 0)
                .style("left", this.options.margins.left + 'px');

            this._ctx = canvas[0][0].getContext('2d');
        }

        // contourModel
        this.contourModel = new LW.ContourModel();
    },

    _setMask: function(){
        this.id = L.stamp(this);
        var x = this._width()-1,y = this._height()-1;
        var defs = this.g.append('defs');
        var clipPath = defs.append('clipPath').attr('id','profile-mask'+this.id);
        var d = 'M1 1L1 '+ y +'L' + x + ' ' + y + 'L' + x + ' 1Z';
        clipPath.append('path').attr('d',d);

    },

    _getxScale: function (orient) {
        var pTime = this.data.forecastTime,xTick = this.options.xTick;
        var xAxisType = this.options.xAxisType,timeFormat = this.options.timeFormat;
        pTime = new Date(pTime.slice(0,4),parseInt(pTime.slice(4,6))-1,pTime.slice(6,8),pTime.slice(8,10),pTime.slice(10,12));
        var _x = d3.scale.ordinal()
            .domain(this.data.xaxis.map(function (item,i) {
                if(i%xTick===0){
                    var t = new Date(pTime);
                    t[xAxisType === 'hour' ? 'addHours' : 'addMinutes'](item);
                    return t.format(timeFormat);
                }
                else//Tip:d3没有快捷的处理tick的方案，直接return '' 坐标轴也会错误，出此下策
                    return i+'*';
            }))
            .rangePoints([0, this._width()]);
        return d3.svg.axis()
            .scale(_x)
            .tickFormat(function (d) {
                return d.indexOf('*')!==-1?'':d;
            })
            .orient(orient || "bottom")
    },

    _appendXaxis: function (x) {
        var orient = this.options.xAxisOrient,height = orient === 'bottom' ? this._height() : 0;
        x.attr("class", "axis")
            .attr("transform", "translate(0," + height + ")")
            .call(this._getxScale(orient))
            .append("text")
            .attr("x", this._width() + this.options.xUnitP.x)
            .attr("y", this.options.xUnitP.y)
            .style("text-anchor", "end")
            .text(this.options.xUnit);
    },

    _getyDomain1: function(){
        return d3.scale.ordinal()
            .domain(this.data.yaxis)
            .rangePoints([this._height(),0]);
    },
    _getyDomain2: function(){
        var ytick = this._yTick,yaxis = this.data.yaxis;
        var _maxH = this._maxH = yaxis[this.data.yaxis.length-1];
        var tickScale = this.tickScale = 1/(yaxis[1]-yaxis[0]);
        var hpaToRange = this.data.hpa_km[1].map(function (value) {
            return (_maxH - value) * ytick * tickScale;
        });
        return d3.scale.ordinal()
            .domain(this.data.hpa_km[0])
            .range(hpaToRange);
    },

    _getyScale: function () {
        var _y = this.options.yAxisType == 'hpa' ? this._getyDomain1() : this._getyDomain2();

        return d3.svg.axis()
            .scale(_y)
            .orient("left");
    },

    _gety2Scale: function () {
        var _y = this.options.yAxisType == 'hpa' ? this._getyDomain2() : this._getyDomain1();

        return d3.svg.axis()
            .scale(_y)
            .orient("right")
            .tickSize(-this._width() - 1);
    },

    _appendYaxis: function (y) {
        y.attr("class", "y2 axis")
            .call(this._getyScale())
            .append("text")
            .attr("x", 0)
            .attr("y", -15)
            .style("text-anchor", "end")
            .text(this.options.yUnit);
    },

    _appendYaxis2: function (y) {
        y.attr("class", "y axis")
            .attr("transform", "translate(" + this._width() + ",0)")
            .call(this._gety2Scale())
            .append("text")
            .attr("x", 25)
            .attr("y", -15)
            .style("text-anchor", "end")
            .text(this.options.yUnit2);
    },

    /**
     * 设置数据，生成剖面图
     * @method setData
     * @param data {ArrayBuffer} 版本3.0 nc数据
     * @return {LW.Profile.Isoline}
     */
    setData: function (data) {
        if (!data)
            return this;

        // 解析nc数据
        if(this.options.dataType === 'nc')
            data = Sun.Util.Data.changeGridNcToJson(data);
        // 处理色斑图数据
        var elements = this.options.elements;
        if(elements.fill)
            this.contourModel.setContourDataOfChartGrid(data,elements.fill.key,elements.fill.legendData,true);
        for(var key in elements.stroke){
            var item = elements.stroke[key];
            this.contourModel.setContourDataOfChartGrid(data,key,null,false,item.gap);
        }

        LW.Profile.prototype.setData.call(this, data);

        this.clear();

        // update grid
        this._updateGrid();

        // update isoline
        this._updateIsoline();
    },

    /**
     * 清空指示线
     * @param type
     */
    clearIndicator:function(type){
        if (this.g_indicator[type])
            this.g_indicator[type].selectAll("line").remove();
    },
    /**
     * 展示指示线
     * @param type {string} 类型 eg:'hpa'/'km'
     * @param value {Number} 数值
     * @param className {String} 指示线的样式名 默认为'indicator-line'在lw.css中定义
     */
    showIndicator: function (type,value,className) {
        if (!this.g_indicator[type])
            this.g_indicator[type] = this.g.append("g");
        var g_indicator = this.g_indicator[type];
        this.clearIndicator(type);
        if (type === 'hpa')
            value = this._getY(value);
        else if(type === 'km' && this.options.yAxisType === 'hpa')
            value = this._getY(value,true);
        y = this._getXY(0, value).y;

        if(!isNaN(y)){
            g_indicator.append('svg:line')
                .attr('class', className || 'indicator-line')
                .attr('x1', 0)
                .attr('y1', y)
                .attr('x2', this._width())
                .attr('y2', y);
        }
    },

    clear: function(){
        for(var key in this.g_isoline){
            this._clearSvgNode(this.g_isoline[key]);
        }
        if(this._ctx)
            this._ctx.clearRect(0, 0, this._width(), this._height() + this.options.margins.top);
    },

    setElementVisible:function(e,visible){
        var target = e === 'uv' ? this.canvas : this.g_isoline[e];
        if(target)
            visible ? target.style('display','block') : target.style('display','none');
    },

    _updateIsoline: function () {
        this._appendIsoline(this.g_isoline);
    },

    _appendIsoline: function (g) {
        // fill
        var data = this.data.data;
        var e_fill = this.options.elements.fill;
        if (data && e_fill) {
            var eData = data[e_fill.key];
            if (eData && eData.planeitems)
                this._appendFillPath(g[e_fill.key], eData.planeitems);
        }

        // stroke
        var strokeElements = this.options.elements.stroke;
        if (data && strokeElements) {
            for (var e in strokeElements) {
                eData = data[e];
                var ele = strokeElements[e];
                if (eData && ele)
                    this._appendStrokePath(g[e], eData.lineitems, ele.color);
            }
        }
    },

    _appendFillPath: function (g, data) {
        for (var i = 0; i < data.length; i++) {
            var item = data[i];
            var path = g.append("path");
            var d = this._projectFillPath(item.pointitems);
            path.attr("fill", item.planecolor)
                .attr("d", d)
                .attr('fill-rule','evenodd')
                .attr("fill-opacity",this.options.elements.fill.opacity||1);
        }
    },

    _projectFillPath: function (pointitems) {
        var rings = '';
        // interpolate
        var svgLine = d3.svg.line(), interpolateType= 'basis-closed';
        svgLine.interpolate(interpolateType);
        for (var i = 0; i < pointitems.length; i++) {
            // get d of path
            var items = pointitems[i];
            var ring = [];
            for (var j = 0; j < items.length; j++) {
                var p = this._getXY(items[j][1], items[j][0]);
                ring[j] = [p.x, p.y];
            }
            var d = svgLine(ring);
            rings += d;
        }
        return rings;
    },

    _appendStrokePath: function (g, data, color) {
        for (var i = 0; i < data.length; i++) {
            var item = data[i];
            var path = g.append("path");
            var d = this._projectStrokePath(item);
            path.attr("stroke", color)
                .attr("fill", 'none')
                .attr("d", d);
            this._setLineLabel(g, item.pointitems, Sun.Util.Math.toFixed(item.linevalue, 2), color, (i%5)+1);
            if (item.linevalue < 0)
                path.attr("stroke-dasharray", "3,3");
        }
    },

    _projectStrokePath: function (line) {
        // interpolate
        var svgLine = d3.svg.line();
        var interpolateType = line.linetype == 0 ? 'basis' : 'basis-closed';
        svgLine.interpolate(interpolateType);

        var points = line.pointitems;
        var ring = [];
        for (var i = 0; i < points.length; i++) {
            var p = this._getXY(points[i][1], points[i][0]);
            ring[i] = [p.x, p.y];
        }
        return svgLine(ring);
    },

    _getLpoint: function (point) {
        var xy = this._getXY(point[0], point[1]);
        return L.point(xy.x, xy.y);
    },

    _setLineLabel: function (g, points, value, color, i0) {
        var d = Math.pow(250,2);
        var pFirst = points[0];
        var pLast = points[0];
        var p0 = this._getLpoint(pFirst);
        var labeled = false;
        var flag = false;
        for (var i = 0; i < points.length - 1; i+=i0) {
            var p1 = points[i];
            var p2 = points[i + 1];
            var p = [(p1[1] + p2[1]) / 2, (p1[0] + p2[0]) / 2];
            var xyLast = this._getLpoint(pLast);
            var xyCur = this._getLpoint(p);
            var s = 10;
            if(xyCur.x>s && xyCur.y>s && xyCur.x<this._width()-s && xyCur.y<this._height()-s){
                if (distance(xyLast,xyCur) >= d) {
                    append_t();
                    pLast = p;
                    labeled = true;
                }
                else if (!labeled && distance(p0,xyCur) >= 50)
                    flag = true;
            }
        }
        if (!labeled && flag) {
            i = parseInt(points.length / 2);
            p1 = points[i];
            i = i + 1 >= points.length ? 0 : i + 1;
            p2 = points[i];
            p = [(p1[1] + p2[1]) / 2, (p1[0] + p2[0]) / 2];
            xyCur = this._getLpoint(p);
            append_t();
        }

        function append_t() {
            //Tip:直接在一个text中加stroke描边很糊，所以增加一个文本在地下做描边
            g.append("text").attr("x", xyCur.x - 6).attr("y", xyCur.y + 4).text(value).attr("stroke", '#fff')
                .style('font-size', '12px').style('font-weight', 'bold');
            g.append("text").attr("x", xyCur.x - 6).attr("y", xyCur.y + 4).text(value).attr("fill", color)
                .style('font-size', '12px').style('font-weight', 'bold');
            //.attr("transform","rotate("+rotation+","+xyCur.x+","+xyCur.y+")");
        }
        function distance(p1,p2) {
            return Math.pow(p1.x-p2.x,2)+Math.pow(p1.y-p2.y,2)
        }
    },

    _updateGrid: function () {
        if (!this._ctx) return;
        this._ctx.strokeStyle = this.options.elements.grid.uv.color;
        this._ctx.fillStyle = this.options.elements.grid.uv.color;
        this._ctx.lineWidth = 1;

        // draw
        if (this.data.data.uv) {
            var invalidValue = this.data.invalidValue;
            var data = this.data.data.uv.data;
            var yaxisType = this.options.yAxisType;
            // var yaxis = this._hpaToKm(this.data.yaxis_uv);
            var yaxis = this.data.yaxis_uv;
            for (var i = 0; i < yaxis.length; i++) {
                for (var j = 0; j < this.data.xaxis.length; j++) {
                    var index = this.data.xaxis.length * i + j;
                    var uvValue = [data[0][index], data[1][index]];
                    if (uvValue[0] != 0 && uvValue[1] != 0 && uvValue[0] != invalidValue && uvValue[1] != invalidValue) {
                        var w = Sun.Util.Weather.wind_getWindByUV(uvValue);
                        var p = this._getXY1(j,yaxisType == 'hpa' ? i : this._getY(yaxis[i]));
                        p.y += this.options.margins.top;
                        Sun.Util.Geometry.drawWindByPosition(this._ctx, w.speed, w.dir, p, true, 25);

                    }
                }
            }
        }
    },
    _getXY1: function (xIndex, yIndex) {
        return {x: this._xTick * xIndex + 1, y: this._height() - this._yTick * yIndex*this.tickScale};
    },

    _getXY: function (xIndex, yIndex) {
        return {x: this._xTick * xIndex + 1, y: this._height() - this._yTick * yIndex};
    },


    /**
     * 根据hpa/km获取对应图表的索引位置
     * @param value {int} hpa数值
     * @param kmToHpa {Boolean} 是否是km转hpa。默认是hpa转km索引位置,若该属性为true，则计算km转hpa索引位置
     *                          Tip:在yAxisType为hpa时，计算hpa自己的索引位置
     * @return {number}
     * @private
     */
    _getY:function (value,kmToHpa) {
        var hpa_km = this.data.hpa_km;
        var idx0 = kmToHpa ? 1 : 0;
        var idx1 = kmToHpa ? 0 : 1;
        var yHpa = this.options.yAxisType == 'hpa';// Tip:如果只有hpa的y轴，则根据hpa算出索引的位置
        for(var i=1;i<hpa_km[idx0].length;i++){
            var i1 = kmToHpa ? i : i-1;// Tip:由于hpa数据为由大到小，km数据为由小到大
            var i2 = kmToHpa ? i-1 : i;
            var hpa1 = hpa_km[idx0][i1], hpa2 = hpa_km[idx0][i2];
            if(value<=hpa1 && value>=hpa2){
                var p = (value-hpa2)/(hpa1-hpa2);
                if(kmToHpa)
                    p = 1-p;
                var height1 = yHpa ? i-1 : hpa_km[idx1][i1], height2 = yHpa ? i : hpa_km[idx1][i2];
                return p*(height1-height2)+height2;
            }
        }
    },

    _hpaToKm: function (hPas) {
        var hpa_km = this.data.hpa_km;
        return km = hPas.map(function (hpa) {
            var idx = hpa_km[0].indexOf(hpa);
            return idx>=0 ? hpa_km[1][idx] : 0;
        });
    }

});


/**
 * 数值预报空间剖面
 *
 * Features :
 *      1. 该剖面为空间剖面，x轴为经纬度，间隔由options设置
 *      2. 需引用d3.js
 *
 * Update Note：
 *      + v1.0.2 ：Created
 *
 * @class LW.Profile.Isoline.Space
 * @extends LW.Profile.Isoline
 * @demo demo/plot/profileIsoline_space.html  {数值预报剖面--空间剖面}
 */

/**
 * @class LW.Profile.Isoline.Space
 * @constructor
 * @param panelContainer {string} 面板容器 style="position: absolute;"
 * @param map {L.Map} 地图
 * @param options {object} 外部属性，可重设Properties
 * @returns {LW.Profile.Isoline.Space}
 */
LW.Profile.Isoline.Space = LW.Profile.Isoline.extend({

    options: {
        /**
         * x轴的个数
         * @property xSize
         * @type {int}
         * @default 6
         */
        xSize: 6,
        /**
         * x轴单位
         * @property xUnit
         * @type {string}
         * @default '(km)'
         */
        xUnit: '',

        margins: {
            top: 30,
            right: 40,
            bottom: 40,
            left: 50
        },

        /**
         * 指示图片地址
         * @property iconUrl
         * @type {string}
         * @default 'marker.png'
         */
        iconUrl: 'marker.png'
    },


    /**
     * 设置剖面起始经纬
     * @method setLatlngs
     * @param sLatlng {L.Latlng} 开始经纬
     * @param eLatlng {L.Latlng} 结束经纬
     */
    setLatlngs: function (sLatlng, eLatlng) {
        this.sLatlng = sLatlng;
        this.eLatlng = eLatlng;
    },

    _updateAxis: function () {
        LW.Profile.prototype._updateAxis.call(this);

        this._x2axisgraphicnode = this._x2axisgraphicnode || this.g.append("g");
        this._clearSvgNode(this._x2axisgraphicnode);
        this._appendXaxis2(this._x2axisgraphicnode);
    },

    _appendXaxis2: function (x) {
        x.attr("class", "x axis-none-line")
            .attr("transform", "translate(0," + (this._height() + 15) + ")")
            .call(this._getx2Scale());
    },

    _getxScale: function () {
        if (this.sLatlng && this.eLatlng) {
            var nlng = (this.eLatlng.lng - this.sLatlng.lng) / (this.options.xSize - 1);
            var xAxis = [];
            for (var i = 0; i < this.options.xSize; i++) {
                var lng = Sun.Util.Math.toFixed(this.sLatlng.lng + nlng * i, 2);
                xAxis.push(lng + 'E');
            }
            var _x = d3.scale.ordinal()
                .domain(xAxis)
                .rangePoints([0, this._width()]);

            return d3.svg.axis()
                .scale(_x)
                .orient("bottom")
        }
    },
    _getx2Scale: function () {
        var nlat = (this.eLatlng.lat - this.sLatlng.lat) / (this.options.xSize - 1);
        var xAxis = [];
        for (var i = 0; i < this.options.xSize; i++) {
            var lat = Sun.Util.Math.toFixed(this.sLatlng.lat + nlat * i, 3);
            xAxis.push(lat + 'N');
        }
        var _x = d3.scale.ordinal()
            .domain(xAxis)
            .rangePoints([0, this._width()]);

        return d3.svg.axis()
            .scale(_x)
            .orient("bottom")
    },

    _initialShow: function () {
        LW.Profile.Isoline.prototype._initialShow.call(this);

        // upper svg
        this._upperSvg = this.cont.append("svg");
        this._upperSvg.attr("width", this.options.width - this.options.margins.left)
            .attr("height", this.options.margins.top + this._height())
            .style("position", "absolute")
            .style("top", 0)
            .style("left", this.options.margins.left);

        this._appendFoucs();
    },

    _appendFoucs: function () {
        // focus line
        var focusG = this._focusG = this._upperSvg.append("g");
        this._mousefocus = focusG.append('svg:line')
            .attr('class', 'mouse-focus-line')
            .attr('x2', '0')
            .attr('y2', '0')
            .attr('x1', '0')
            .attr('y1', '0');
        this._focuslabelY = focusG.append("svg:text")
            .style("pointer-events", "none")
            .attr("class", "mouse-focus-label-y")
            .attr("y", 20)
            .attr("x", 10);

        // focus backgroud
        this._upperSvg.append("rect")
            .attr("width", this._width())
            .attr("height", this._height())
            .style("fill", "none")
            .style("stroke", "none")
            .style("pointer-events", "all")
            .on("mousemove.focus", this._mousemoveHandler.bind(this))
            .on("mouseout.focus", this._mouseoutHandler.bind(this));
    },

    // mouse focus handle

    _mousemoveHandler: function (d, i, ctx) {
        if (this.sLatlng && this.eLatlng) {
            var coords = d3.mouse(this.canvas.node());
            var latlng = this._findLatlngForX(coords[0]);
            this._showDiagramIndicator(latlng, coords[0]);


            if (!this._marker) {
                var iconUrl = LW.defaultIconPath() + this.options.iconUrl;
                this._marker = new L.Marker(latlng, {icon: new L.Icon({iconUrl: iconUrl, iconAnchor: L.point(12, 32)})})
                    .addTo(this._map);
            } else {
                this._marker.setLatLng(latlng);
            }
        }
    },
    _mouseoutHandler: function () {
        if (this._marker) {
            this._map.removeLayer(this._marker);
            this._marker = null;
        }
        this._focusG.style("visibility", "hidden");
    },

    _findLatlngForX: function (x) {
        var latlng1 = this.sLatlng;
        var latlng2 = this.eLatlng;
        var scale = x / this._width();
        var lat = latlng1.lat + (latlng2.lat - latlng1.lat) * scale;
        var lng = latlng1.lng + (latlng2.lng - latlng1.lng) * scale;
        return [lat, lng];
    },

    _showDiagramIndicator: function (latlng, xCoordinate) {
        this._focusG.style("visibility", "visible");
        this._mousefocus.attr('x1', xCoordinate)
            .attr('y1', this.options.margins.top)
            .attr('x2', xCoordinate)
            .attr('y2', this.options.margins.top + this._height())
            .classed('hidden', false);

        var text = Sun.Util.Math.toFixed(latlng[1], 2) + 'E/' + Sun.Util.Math.toFixed(latlng[0], 2) + 'N';
        this._focuslabelY.text('指示位置：' + text);
    }
});

/**
 * @module Layer.Plot.Profile
 */

(function () {

    /**
     *  以下常量与公式均为从《天气分析预报物理量计算基础》书籍中查询得到
     *  若未特殊说明，所有温度单位为℃，气压单位为hPa
     */
    var Const = {
        Rv:461.5,  //水汽比气体常数     单位:J/(Kg*K)    //参见P6
        Rd : 287.05, //干空气比气体常数   单位:J/(Kg*K)   //参见P6
        g : 9.81,    //重力加速度         单位:m/s^2    //参见P17
        cpd : 1004.675, //干空气的定压比热   单位:J/(Kg*K)    //参见P39
        cw : 4185.7,     //湿空气比定压热    单位:J/(Kg*K)   //参见P39
        cp : 1004.07,   //干空气比定压热容   单位:J/(Kg*K)    //参见P40
        //水汽化潜热（近似值，实际为变量，与温度相关，由于变化很小，近似为不变）若需要精确值，使用Lw方法获取；
        Lw : 2.501 * Math.pow(10,6),      // 单位:J/Kg    //参见P4
        TK : 273.15, //0℃对应的绝对温度     // 单位:K //参见P5
        P00 : 1000,  //1000hPa气压标准值
        Omega : 7.292 * Math.pow(10, -5),    //地球自转角速度(来源于百度百科:地球自转角速度)
        H_UNIT : 10,  // 高度单位,高度值*10
        waterDensity : 1 // 水的密度(单位g/cm3) 参考百度百科
    };

    // var Range={
    //         adiabat:{start:-80,end:180,gap:20},
    //         temp:{start:-120,end:50,gap:10,count:18},
    //         hpa:{start:100,end:1050},
    //         km:{start:-0.5,end:16,gap:1,count:16},
    //         hRatio:[0.05,0.1,0.2,0.5,1,1.5,2,3,4,6,8,12,16,20,24,30]
    // };

    // var hpa_km=[[1000,950,850,700,500,400,300,200,100],[0,0.7,1.5,3,5.5,7,9,12,16]];
    var hpa_km=[[1050,1000,925,850,700,500,400,300,200,100],[-0.5,0,0.7,1.47,3.05,5.6,7.3,9.5,12.4,16]];

    /**
     * T-LnP图
     *
     * Features :
     *      1. 干绝热线、湿绝热线、等比湿饱和线
     *      2. 温度曲线、状态曲线、露点温度线；温度曲线和状态曲线相交部分的面积绘制
     *      3. 需引用d3.js
     *
     * Update Note：
     *      + v1.3.0-dev ：Created
     *      + v1.4.1 : 坐标系由1000hpa到1050hpa，以适应地面坐标大于1000hpa的情况
     *      + v1.5.2 : Ranges范围配置由常量改为options属性
     *
     * @class LW.Profile.T_LnP
     * @extends LW.Profile
     * @demo demo/plot/profile/profile_T-Inp.html {T-LnP图}
     */

    /**
     * @class LW.Profile.T_LnP
     * @constructor
     * @param panelContainer {string} 面板容器 style="position: absolute;"
     * @param map {L.Map} 地图
     * @param options {object} 外部属性，可重设Properties
     * @returns {LW.Profile.T_LnP}
     */

    LW.Profile.T_LnP = LW.Profile.extend({
        options: {
            // height: 512,
            width: 800,
            margins: {
                top: 30,
                right: 100,
                bottom: 30,
                left: 50
            },
            /**
             * 各种线的颜色配置
             * @property colors
             * @type {object}
             * @default {
                    dayAdiabat:'#ffafaf',
                    wetAdiabat:'#94c294',
                    hRation:'#94c294',
                    state:'#322cde',
                    t:'#fc312e',
                    td:'#158815'
                }
             */
            colors:{
                dayAdiabat:'#ffafaf',
                wetAdiabat:'#94c294',
                hRation:'#94c294',
                state:'#322cde',
                t:'#fc312e',
                td:'#158815'
            },
            /**
             * 各种线的数值范围
             * @property ranges
             * @type {object}
             * @default {
                    adiabat:{start:-80,end:180,gap:20},
                    temp:{start:-120,end:50,gap:10},
                    hpa:{start:100,end:1050},
                    km:{start:-0.5,end:16,gap:1,count:16},
                    hRatio:[0.05,0.1,0.2,0.5,1,1.5,2,3,4,6,8,12,16,20,24,30]
                }
             */
            ranges:{
                adiabat:{start:-80,end:180,gap:20},
                temp:{start:-120,end:50,gap:10},
                hpa:{start:100,end:1050},
                km:{start:-0.5,end:16,gap:1,count:16},
                hRatio:[0.05,0.1,0.2,0.5,1,1.5,2,3,4,6,8,12,16,20,24,30]
            }
        },


        _initialShow: function () {
            LW.Profile.prototype._initialShow.call(this);

            var self = this;
            this.lineGen = d3.svg.line()
                .x(function(d) {
                    return self.xScale(d.t);
                })
                .y(function(d) {
                    return self.yScale(self._getY(d.p));
                    // return self.yScale(d.p);
                });
            this.position = function (value) {
                return {x:self.xScale(value.t),y:self.yScale(self._getY(value.p))};
            };

            this.g_dryAdiabat = this.g.append("g");
            this.g_wetAdiabat = this.g.append("g");
            this.g_hRatio = this.g.append("g");
            this.g_feature = this.g.append("g");

            //wind canvas
            var canvas = this.canvas = this.cont.append("canvas");
            canvas.attr("width", '60')
                .attr("height", this._height() + this.options.margins.top+20)
                .style("position", "absolute")
                .style("top", 0)
                .style("left", this.options.margins.left+this._width()+30 + 'px');

            this._ctx = canvas[0][0].getContext('2d');
        },

        _getxScale: function () {
            var range = this.options.ranges;
            range.temp.count = (range.temp.end-range.temp.start)/range.temp.gap;
            var _x = this.xScale = d3.scale.linear()
                .domain([range.temp.start,range.temp.end])
                .range([0, this._width()]);


            return d3.svg.axis()
                .scale(_x)
                .orient("bottom")
                .ticks(range.temp.count)
                .tickSize(-this._height() - 1);
        },

        // 大气压坐标系
        _getyScale: function () {
            var ytick = this._yTick;
            var _maxH = this._maxH = 16;
            var hpaToRange = hpa_km[1].map(function (value) {
                return (_maxH - value) * ytick
            });
            var hpa = hpa_km[0].concat();
            hpa[0] = '';//1050hpa不展示
            var _y = d3.scale.ordinal()
                .domain(hpa)
                .range(hpaToRange);

            // var _y2 = this.yScale = d3.scale.linear()
            //     .domain([1000,100])
            //     .range([this._height(),0]);

            return d3.svg.axis()
                .scale(_y)
                .orient("right")
                .tickSize(-this._width() - 1);
        },

        // 海拔高度坐标系
        _gety2Scale: function () {
            var range = this.options.ranges;
            var _y2 = this.yScale = d3.scale.linear()
                .domain([range.km.start,range.km.end])
                .range([this._height(),0]);

            return d3.svg.axis()
                .scale(_y2)
                .orient("left")
                .ticks(range.km.count);
        },

        _appendYaxis: function (y) {
            y.attr("class", "y2 axis")
                .call(this._gety2Scale())
                .append("text")
                .attr("x", 0)
                .attr("y", -10)
                .style("text-anchor", "end")
                .text(this.options.yUnit2);
        },

        _appendYaxis2: function (y) {
            y.attr("class", "y axis")
                .attr("transform", "translate(" + this._width() + ",0)")
                .call(this._getyScale())
                .append("text")
                .attr("x", 25)
                .attr("y", -10)
                .style("text-anchor", "end")
                .text(this.options.yUnit);
        },

        setData: function (data) {
            this.clear();
            if (!data)
                return this;

            LW.Profile.prototype.setData.call(this,data);
            this._updateBaseLine();
            this._updateFeatureLine();
            this._updateWindVane();
        },

        clear: function(){
            this._clearSvgNode(this.g_dryAdiabat);
            this._clearSvgNode(this.g_wetAdiabat);
            this._clearSvgNode(this.g_hRatio);
            this._clearSvgNode(this.g_feature);
            this._ctx.clearRect(0,0,60,this._height() + this.options.margins.top+20);
        },

        _updateBaseLine: function () {

            var colors = this.options.colors,range = this.options.ranges;
            var lineGen = this.lineGen,getPosition=this.position;
            drawDryAdiabat(this.g_dryAdiabat);//干绝热线
            drawWetAdiabat(this.g_wetAdiabat);//湿绝热线
            drawHRatio(this.g_hRatio);//等比湿饱和线

            function drawDryAdiabat(g){
                for(var i=range.adiabat.start;i<=range.adiabat.end;i+=range.adiabat.gap){
                    var line=[];
                    for(var p=range.hpa.start;p<=range.hpa.end;p+=1){
                        var t = dryA_t(p,i);
                        if(t>=range.temp.start && t<=range.temp.end)
                            line.push({t:t,p:p});
                    }
                    drawLine(g,line,colors.dayAdiabat,{value:i,pos:0.2})
                }
            }
            function drawWetAdiabat(g) {
                for(var i=range.adiabat.start;i<=range.adiabat.end;i+=range.adiabat.gap){
                    var line=[];
                    for(var p=range.hpa.start;p<=range.hpa.end;p+=1){
                        var t = wetA_t(p,i,0.3);
                        if(t>=range.temp.start && t<=range.temp.end)
                            line.push({t:t,p:p});
                    }
                    drawLine(g,line,colors.wetAdiabat,{value:i,pos:0.3})
                }
            }
            function drawHRatio(g) {
                for(var i=0;i<=range.hRatio.length;i++) {
                    var line = [];
                    for(var p=400;p<=range.hpa.end;p+=1){
                        var t = hRatio_t(range.hRatio[i],p);
                        if(t>=range.temp.start && t<=range.temp.end)
                            line.push({t:t,p:p});
                    }
                    drawLine(g,line,colors.hRation,{value:range.hRatio[i],pos:0.3});
                }
            }

            function drawLine(g,line,color,text) {
                if(line.length>0){
                    g.append('svg:path')
                        .attr('d', lineGen(line))
                        .attr({'stroke':color,'stroke-dasharray':'3,3','stroke-width':1,'fill':'none'});
                    if(text){
                        var idx = Math.ceil(line.length*text.pos);
                        var position = getPosition(line[idx]);
                        g.append("text")
                            .attr({x:position.x,y:position.y,fill:color})
                            .style("font-size", 12)
                            .style("text-anchor", "middle")
                            .text(text.value);
                    }
                }
            }
        },

        _updateFeatureLine:function () {
            var colors = this.options.colors;
            var lineGen = this.lineGen,getPosition = this.position;
            var data = this.data,g = this.g_feature;
            var range = this.data.range,invalid=data.invalid;

            // 绘制颜色区块
            var iPoint = data.heightPoints.LFC,color = colors.t;
            if(iPoint != invalid)
                drawArea(data.ZP[0],iPoint,colors.state);
            if(data.heightPoints.EL != invalid){
                drawArea(iPoint,data.heightPoints.EL,colors.t);
                iPoint = data.heightPoints.EL;
                color = colors.state;
            }
            if(iPoint != invalid)
                drawArea(iPoint,data.heightPoints.EAL,color);

            // 绘制折线
            drawLine(data.ZT,colors.state,false);//状态曲线
            drawLine(data.CTD,colors.td,false);//露点温度
            drawLine(data.CT,colors.t,true);//温度曲线

            // 绘制标识线
            drawSymbolLine();
            drawTempLine();


            function drawLine(temp,color,drawPoints) {
                var line = [],points=[];
                for(var i=0;i<data.ZP.length;i++){
                    var p = data.ZP[i];
                    var item = {t:temp[i],p:p};
                    line.push(item);
                    if(drawPoints){
                        if(hpa_km[0].indexOf(p)!=-1)
                            points.push(item);
                    }
                }
                g.append('svg:path')
                    .attr('d', lineGen(line))
                    .attr('stroke', color)
                    .attr('stroke-width', 2)
                    .attr('fill', 'none');

                if(drawPoints){
                    for(var k=0;k<points.length;k++){
                        var pos = getPosition(points[k]);
                        g.append('circle')
                            .attr({'cx':pos.x,'cy':pos.y,'r':2.5,'fill':color});
                        g.append("text")
                            .attr({x:pos.x+5,y:pos.y+5,fill:color})
                            .style("font-size", 12)
                            .style("text-anchor", "start")
                            .text(points[k].t);
                    }
                }
            }

            function drawArea(end,start,color) {
                var line1 = [], line2 = [];
                for(var i=0;i<data.ZP.length;i++){
                    var p = data.ZP[i];
                    if(p>=start && p<=end){
                        line1.push({t:data.ZT[i],p:p});
                        line2.push({t:data.CT[i],p:p});
                    }
                }
                var line = line1.concat(line2.reverse());
                g.append('svg:path')
                    .attr('d', lineGen(line))
                    .attr('stroke', 'none')
                    .attr('fill', color)
                    .attr('fill-opacity', 0.4);
            }

            function drawSymbolLine() {
                for(var key in data.heightPoints){
                    if(key != 'EAL'){
                        var p = data.heightPoints[key];
                        if(p!=invalid){
                            var line = [{t:42,p:p},{t:48,p:p}];
                            var position = getPosition({t:42,p:p});
                            g.append('svg:path')
                                .attr('d', lineGen(line))
                                .attr({'stroke':'#333','stroke-width':2,'fill':'none'});
                            g.append("text")
                                .attr({x:position.x,y:position.y-1,fill:'#333'})
                                .style("font-size", 10)
                                .style("text-anchor", "start")
                                .text(key.toLocaleUpperCase());
                        }
                    }
                }
            }

            function drawTempLine() {
                for(var i=0;i<data.temPoints.length;i++){
                    var p = data.temPoints[i].hPa;
                    if(p!=invalid){
                        var line = [{t:42,p:p},{t:48,p:p}];
                        var position = getPosition({t:42,p:p});
                        g.append('svg:path')
                            .attr('d', lineGen(line))
                            .attr({'stroke':'#4169e1','stroke-width':2,'fill':'none'});
                        g.append("text")
                            .attr({x:position.x,y:position.y+5,fill:'#4169e1'})
                            .style("font-size", 12)
                            .style("text-anchor", "end")
                            .text(data.temPoints[i].name+'℃');
                    }
                }
            }
        },

        _updateWindVane:function () {
            var data = this.data,invalid=data.invalid;
            var ctx = this._ctx,y_offsest = this.options.margins.top;
            for(var i=0;i<data.WIND_P.length;i++){
                var p = data.WIND_P[i];
                var w = data.WIND_VALUE[i];
                if(w[0] != invalid && w[1] != invalid){
                    var y = this.yScale(this._getY(p))+y_offsest;
                    Sun.Util.Geometry.drawWindByPosition(ctx,w[1],w[0],{x:30,y:y},true);
                }
            }
        },

        _getY:function (hpa) {
            for(var i=1;i<hpa_km[0].length;i++){
                var hpa1 = hpa_km[0][i-1], hpa2 = hpa_km[0][i];
                if(hpa<=hpa1 && hpa>=hpa2){
                    var p = (hpa-hpa2)/(hpa1-hpa2);
                    var height1 = hpa_km[1][i-1], height2 = hpa_km[1][i];
                    return p*(height1-height2)+height2;
                }
            }
        },

        _setXYTick: function () {
            var range = this.options.ranges;
            this._xTick = this._width()/range.temp.count;
            this._yTick = this._height()/(range.km.count-range.km.start);
        },

        _getXY: function (xIndex, yIndex) {
            return {x: this._xTick * xIndex + 1, y: this._yTick * yIndex};
        }

    });

    /**
     * 位温计算公式 参见P33 4.1.8
     * @param t   气温（单位℃)
     * @param p     气压(单位hPa）
     * @return      位温（单位℃）
     */
    function dryA_ww(t,p) {
        //公式: θ = T * (1000/p)^(Rd/Cpd)
        return (t + Const.TK ) * Math.pow(Const.P00/p,Const.Rd/Const.cpd) - Const.TK;
    }
    /**
     * 根据位温公式逆推得到温度
     * @param p     气压
     * @param θ {number}
     * @return {number}   抬升至气压处温度
     */
    function dryA_t(p,θ) {
        // 由位温公式逆推：T = θ/((1000/p)^(Rd/Cpd))
        var fm1 = Math.pow((Const.P00)/p,Const.Rd/Const.cpd);
        return (θ + Const.TK )/fm1 - Const.TK;
    }
    /**
     * 根据位温公式逆推得到气压
     * @param t     气温（单位℃）
     * @param θ  {number}
     * @return {number}   气温对应气压（单位hPa）
     */
    function dryA_p(t,θ) {
        return 1000 * Math.pow((t + Const.TK)/(θ + Const.TK) , Const.cpd/Const.Rd);
    }

    function wetA_ww(t, p) {
        var θ = dryA_ww(t,p);
        var r = HHB(t,p);
        var lw = Lw(t);
        var s1 = (θ + Const.TK) * (1 + 0.46 * r); //计算第一部分
        var s2 = Const.cpd * (t + Const.TK); //计算真数分母
        var s3 = Math.exp(lw * r / s2);  //计算幂计算部分
        return s1 * s3 - Const.TK;
    }

    function wetA_t( p, theta, jd){
        //设置初始值
        var t_start = -140,t_end = 55;
        var lt = t_start * 0.5 + t_end * 0.5;

        // 为避免此处发生死循环,加入检测条件跳出
        var j = 0;
        while ( t_end - t_start >= Math.pow(10,-1 * jd) ){

            j++;
            if (j >= 2000)
                return lt;

            var v = wetA_ww(lt,p);
            if ( v == theta) return lt;
            if ( v < theta ) t_start = lt;
            if ( v > theta ) t_end = lt;
            lt = t_start * 0.5 + t_end * 0.5;
        }
        return lt;
    }

    function hRatio_t(hRatio,p) {
        var e = p*hRatio/622;
        var lne = Math.log(e/6.112);
        return (243.5*lne)/(17.67-lne);
    }
    /**
     * 水汽压(根据露点温度差计算) 参见P5 1.1.5
     * @param   td 当前温度下的露点温度
     * @return  水汽压
     */
    function SQY( td){
        var Td = td + Const.TK;
        return Math.exp(53.67957 - 6743.769/Td - 4.8451 * Math.log(Td));
    }

    /**
     * 混合比 参见P9 1.3.13
     * @param td 当前温度下的露点温度
     * @param p 气压
     * @return  比湿 (单位)Kg/Kg
     */
    function HHB( td, p){
        //混合比公式(约等于比湿)q = 0.622 * e/p
        var e = SQY(td);
        return 0.622 * e/(p - e);
    }
    /**
     * 水汽化潜热精确公式        //参见P17
     * @param t     温度
     * @return {number}
     */
    function Lw(t){
        return Const.Lw - 0.00237 * Math.pow(10,6) * t;
    }
})();


/**
 * @module Layer.Plot.Profile
 */

/**
 * 雷达剖面
 *
 * Features :
 *      1. 该剖面为空间剖面，需用Profile.Editable绘制两点，并将起始经纬传入用于绘制x坐标轴
 *      2. 为了UI美观,雷达高度为0-20km，间隔为0.5km
 *      3. 可支持鼠标移过剖面图，在gis上显示改点对应的位置
 *      4. 需引用d3.js
 *
 * @class LW.Profile.Radar
 * @extends LW.Profile
 * @demo demo/plot/profile/profileRadar.html  {雷达剖面}
 */

/**
 * @class LW.Profile.Radar
 * @constructor
 * @param panelContainer {string} 面板容器 style="position: absolute;"
 * @param map {L.Map} 地图
 * @param options {object} 外部属性，可重设Properties
 * @returns {LW.Profile.Radar}
 */
LW.Profile.Radar = LW.Profile.extend({
    options: {
        /**
         * 剖面的css class
         * @property className
         * @type {string}
         * @default 'lw-radar-profile'
         */
        className: 'lw-radar-profile',

        /**
         * 剖面长度（单位：px）
         * @property width
         * @type {number}
         * @default 600
         */
        width: 600,

        /**
         * 剖面宽度（单位：px）
         *
         * 注：最好使用默认长宽
         * @property height
         * @type {number}
         * @default 260
         */
        height: 260,

        /**
         * 剖面外边距，可以调整剖面与外容器上下左右的距离
         * @property margins
         * @type {object}
         * @default {top: 30,right: 40,bottom: 30,left: 50}
         */
        margins: {
            top: 30,
            right: 40,
            bottom: 30,
            left: 50
        },

        /**
         * x轴单位
         * @property xUnit
         * @type {string}
         * @default '(km)'
         */
        xUnit: '(km)',

        /**
         * x轴单位位置
         * @property xUnitP
         * @type {string}
         * @default {x: 35,y: 17}
         */
        xUnitP: {
            x: 35,
            y: 17
        },

        /**
         * y轴单位
         * @property yUnit
         * @type {string}
         * @default '(km)'
         */
        yUnit: '(km)',

        /**
         * 雷达图例数据
         * @property legendData
         * @type {Array}
         * @default null
         */
        legendData: null,

        /**
         * 指示图片地址
         * @property iconUrl
         * @type {string}
         * @default 'marker.png'
         */
        iconUrl: 'marker.png'
    },

    _initialShow: function () {
        LW.Profile.prototype._initialShow.call(this);

        //canvas
        var canvas = this.canvas = this.cont.append("canvas");
        canvas.attr("width", this._width())
            .attr("height", this._height())
            .style("position", "absolute")
            .style("top", (this.options.margins.top - 0.5) + 'px')
            .style("left", (this.options.margins.left + 0.5) + 'px');

        this._ctx = canvas[0][0].getContext('2d');


        // upper svg
        this._upperSvg = this.cont.append("svg");
        this._upperSvg.attr("width", this.options.width - this.options.margins.left)
            .attr("height", this._height())
            .style("position", "absolute")
            .style("top", this.options.margins.top)
            .style("left", this.options.margins.left);

        this._appendFoucs();
    },

    _appendFoucs: function () {
        // focus line
        var focusG = this._focusG = this._upperSvg.append("g");
        this._mousefocus = focusG.append('svg:line')
            .attr('class', 'mouse-focus-line')
            .attr('x2', '0')
            .attr('y2', '0')
            .attr('x1', '0')
            .attr('y1', '0');
        this._focuslabelY2 = focusG.append("svg:text")
            .style("pointer-events", "none");
        this._focuslabelY = focusG.append("svg:text")
            .style("pointer-events", "none")
            .attr("class", "mouse-focus-label-y");

        // focus backgroud
        this._upperSvg.append("rect")
            .attr("width", this._width())
            .attr("height", this._height())
            .style("fill", "none")
            .style("stroke", "none")
            .style("pointer-events", "all")
            .on("mousemove.focus", this._mousemoveHandler.bind(this))
            .on("mouseout.focus", this._mouseoutHandler.bind(this));
    },

    /**
     * 设置剖面起始经纬
     * @method setLatlngs
     * @param sLatlng {L.Latlng} 开始经纬
     * @param eLatlng {L.Latlng} 结束经纬
     */
    setLatlngs: function (sLatlng, eLatlng) {
        this.sLatlng = sLatlng;
        this.eLatlng = eLatlng;
    },

    _getxScale: function () {
        if (this.sLatlng && this.eLatlng) {
            var d = this.sLatlng.distanceTo(this.eLatlng) / 1000;
            var _x = d3.scale.linear()
                .domain([0, d])
                .range([0, this._width()]);

            return d3.svg.axis()
                .scale(_x)
                .orient("bottom")
                .outerTickSize(-this._height());
        }
    },

    _get5x: function (value) {
        return Math.ceil(value/5)*5;
    },

    _get5xArray: function (value,gap) {
        var v_5x = this._get5x(value);
        var arr=[];
        for(var i=0;i<=v_5x;i+=gap){
            arr.push(i);
        }
        return arr;
    },

    _getyScale: function () {
        /*
         * 为了美观性考虑，y轴定为20公里总高度，每隔5公里绘制辅助线，每隔1公里有刻度
         * 并与数据组协定传回数据也是到20公里
         */
        var domain = this.equalGap ? this._get5xArray(this.height,5) : [];

        var _y = d3.scale.ordinal()
            .domain(domain)
            .rangePoints([this._height(), 0]);

        return d3.svg.axis()
            .scale(_y)
            .orient("left")
            .tickSize(-this._width() - 1)
    },

    _gety2Scale: function () {
        var domain = this.equalGap ? this._get5xArray(this.height,1) : [].concat(this.data.yaxis).reverse();
        var _y = d3.scale.ordinal()
            .domain(domain)
            .rangePoints([this._height(), 0]);

        return d3.svg.axis()
            .scale(_y)
            .orient("left")
            .tickFormat(this.equalGap?'':function (d) {return d})
            .innerTickSize(-8);
    },

    _appendYaxis2: function (y) {
        y.attr("class", "y axis")
            .call(this._gety2Scale());
    },

    _setXYTick: function () {
        this._xTick = (this._width()) / (this.data.xaxiscounts);
        if(this.equalGap){
            var y_len = this._get5x(this.height)/this.gap;
            this._yOff = y_len - this.height/this.gap;
            this._yTick = (this._height()) / (y_len - 1);
        }
        else{
            this._yOff = 0;
            this._yTick = this._height() / (this.data.yaxis.length-1);
        }

    },

    /**
     * 设置数据并绘制
     * @method setData
     * @param data {Array}
     * @param equalGap {Boolean} 是否是等间隔数据
     * @param gap {number}
     * @param height {number}
     */
    setData: function (data,equalGap,gap,height) {
        if (!data)
            return this;

        this.equalGap = typeof equalGap != 'undefined' ? equalGap : true;
        this.gap = gap || 0.5;
        this.height = height || 20;

        LW.Profile.prototype.setData.call(this, data);

        // update grid
        this._updateRadar();
    },

    clear : function () {
        if(this._ctx)
            this._ctx.clearRect(0, 0, this._width(), this._height());
    },

    _updateRadar: function () {
        if (!this._ctx || !this.options.legendData) return;
        // clear
        this._ctx.clearRect(0, 0, this._width(), this._height());

        for (var i = 0, yCounts = this.data.yaxis.length; i < yCounts; i++) {
            for (var j = 0; j < this.data.xaxiscounts; j++) {
                var index = this.data.xaxiscounts * i + j;
                if (index < this.data.data.length) {
                    var colorIndex = this.data.data[index];
                    if (colorIndex != 255 && colorIndex != 0) {
                        var color = this.options.legendData[colorIndex - 1].color;
                        var p = this._getXY(j, i);
                        this._ctx.fillStyle = color;
                        this._ctx.fillRect(p.x, p.y, this._xTick + 1, this._yTick+1);
                    }
                }
            }
        }
    },

    _getXY: function (xIndex, yIndex) {
        return {x: this._xTick * xIndex, y: this._yTick * (yIndex + this._yOff)};
    },


    // mouse focus handle

    _mousemoveHandler: function (d, i, ctx) {
        if(!this.sLatlng || !this.eLatlng)
            return;
        var coords = d3.mouse(this.canvas.node());
        var latlng = this._findLatlngForX(coords[0]);
        this._showDiagramIndicator(latlng, coords[0],coords[1]);


        if (!this._marker) {
            var iconUrl = LW.defaultIconPath() + this.options.iconUrl;
            this._marker = new L.Marker(latlng, {icon: new L.Icon({iconUrl: iconUrl, iconAnchor: L.point(12, 32)})})
                .addTo(this._map);
        } else {
            this._marker.setLatLng(latlng);
        }

    },
    _mouseoutHandler: function () {
        if (this._marker) {
            this._map.removeLayer(this._marker);
            this._marker = null;
        }
        this._focusG.style("visibility", "hidden");
    },

    _findLatlngForX: function (x) {
        var latlng1 = this.sLatlng;
        var latlng2 = this.eLatlng;
        var scale = x / this._width();
        var lat = latlng1.lat + (latlng2.lat - latlng1.lat) * scale;
        var lng = latlng1.lng + (latlng2.lng - latlng1.lng) * scale;
        return [lat, lng];
    },

    _showDiagramIndicator: function (latlng, x, y) {
        var index = Sun.Util.Math.toFixed(y / this._yTick, 0);
        var height = this.data ? this.data.yaxis[index] : '';

        this._focusG.style("visibility", "visible");
        this._mousefocus.attr('x1', x)
            .attr('y1', 0)
            .attr('x2', x)
            .attr('y2', this._height())
            .classed('hidden', false);

        var text = Sun.Util.Math.toFixed(latlng[0], 2) + ',' +
            Sun.Util.Math.toFixed(latlng[1], 2) + ' 高:' + height + 'km';
        var width = Sun.Util.Common.getTextWidth ? (Sun.Util.Common.getTextWidth(text)-20) : 140;
        this._focuslabelY.attr("y", 15)
            .attr("x", x > this._width() / 2 ? x - width : x + 2)
            .text(text);
        this._focuslabelY2.attr("y", 15)
            .attr("x", x > this._width() / 2 ? x - width : x + 2)
            .text(text);
    }
});


/**
 * @module Layer.Plot
 */

/**
 * 交通气象图层
 *
 * Features :
 *      1. 根据网格数据或站点数据展示道路上的气象信息
 *      2. 可以获得分段的道路信息
 *      3. 展示原理：
 *          (1) 将道路数据按给定的最小公里(默认1公里)分段，然后在每段的中间用双线性插值算出值表示这一段。
 *          (2) 不用网格数据直接映射的原因是道路是一条线，不是个区域，若网格映射可能导致地图缩小后一个线上的点即可对应多个网格
 *          (3) 若道路是区域，可直接用LW.GridLayer,将道路区域作为遮罩展示即可
 * Update Note：
 *      + v1.1.0 ：Created
 *
 *
 * @class LW.TrafficLayer
 * @extends LW.CanvasLayer
 * @demo demo/plot/traffic.html  {网格数据}
 */
LW.TrafficLayer = LW.CanvasLayer.extend({
    options: {
        renderer: L.canvas(),
        lineWidth: 3,
        /**
         * 是否数据为网格数据
         * @property sourceGrid
         * @type {boolean}
         * @default false
         */
        sourceGrid: true,
        valueScale: 1,
        minKm: 0.5,
        gradient: false,
        legendData:[],
        dataType:'json'
    },

    initialize: function (pathData,  options) {
        L.setOptions(this, options);
        this.pathData = pathData;
        this.gridModel = new LW.GridModel({dataType:this.options.dataType});
        if (!this.options.sourceGrid)
            this._setContourModel();
    },

    _setContourModel: function () {
        if (this.options.bounds) {
            this.contourModel = new LW.ContourModel(this.options.bounds, this.options.columns, this.options.rows);
        }
    },

    _getDiscreteData: function (data, valueField) {
        var discreteData = [];
        for (var i = 0; i < data.length; i++) {
            var item = data[i];
            var value = item[valueField];
            if (!isNaN(value) && value != null && item['STATIONLAT'] != null && item['STATIONLON'] != null) {
                var dValue = value * this.options.valueScale;
                var dItem = {lat: item['STATIONLAT'], lng: item['STATIONLON'], value: dValue};
                discreteData.push(dItem);
            }
        }
        return discreteData;
    },

    /**
     * 设置数据，可设置网格或站点数据，但数据源需与sourceGrid属性相匹配
     * @method setData
     * @param data {Array} 数据源
     * @param pathData {Array} 道路数据
     * @param legendData {Array} 图例数据
     * @param valueField {string} 值字段名，在站点数据时使用
     */
    setData: function (data, pathData, legendData, valueField) {
        var gridData;
        if(!this.options.sourceGrid){
            if (data && data.length > 2) {
                var discreteData = this._getDiscreteData(data, valueField);
                // 插值
                this.contourModel.interpolate(discreteData);
                gridData = this.contourModel.getGridValueData();
            }
        }
        else
            gridData = data;
        if(gridData) this.gridModel.setData(gridData);
        if(pathData) this.pathData = pathData;
        if(legendData) this.options.legendData = legendData;
        this.data = this._roadInterpolate();
        this._reset();
    },

    _roadInterpolate: function () {
        var geoData = [], listData = [], self = this;
        for (var i = 0; i < this.pathData.length; i++) {
            var item = this.pathData[i].geometry;
            var properties = this.pathData[i].properties;
            var coordinates = item.coordinates;
            if(item.type === 'LineString')
                setItem(coordinates);
            else{
                for (var j = 0; j < coordinates.length; j++) {
                    setItem(coordinates[j],properties.name || properties.NAME);
                }
            }
        }
        return {geoData: geoData, listData: listData};

        function setItem(points,name) {
            var sectionKm = 0, legendIndex = -1;
            var prevPoint = points[0];
            for (var m = 1; m < points.length; m++) {
                // 路段数据
                if (sectionKm === 0) {
                    var traffic = {latlngs: [prevPoint]};
                    geoData.push(traffic);
                }
                sectionKm += L.latLng(prevPoint[1], prevPoint[0]).distanceTo([points[m][1], points[m][0]]) / 1000;
                traffic.latlngs.push(points[m]);
                self._setSegmentValue(traffic);
                if (sectionKm > self.options.minKm)
                    sectionKm = 0;
                prevPoint = points[m];
                // 列表天气描述
                var index = Sun.Util.LegendData.getColorIndex(self.options.legendData, traffic.value);
                if (legendIndex < index)
                    legendIndex = index;
            }
            listData.push({name: name, legendIndex: legendIndex});
        }
    },

    _setSegmentValue: function (segment) {
        // 取该段中点在网格数据中的值
        var gridModel = this.gridModel;
        if(this.options.gradient){
            var p1 = segment.latlngs[0], p2 = segment.latlngs[segment.latlngs.length-1];
            segment.start = gridModel.getInterpolation(p1[1], p1[0]);
            segment.end = gridModel.getInterpolation(p2[1], p2[0]);
        }
        else{
            var index = Math.floor(segment.latlngs.length / 2);
            var latlng = segment.latlngs[index];
            segment.value = gridModel.getInterpolation(latlng[1], latlng[0]);
        }
    },



    /**
     * 获取分段道路气象信息列表
     * @returns {Array} [{legendIndex:-1,name:'G70福银高速_永寿县'}]
     */
    getListData: function () {
        return this.data ? this.data.listData : [];
    },

    clear: function () {
        var size = this._renderer._bounds.getSize();
        this._renderer._ctx.clearRect(0, 0, size.x, size.y);
    },

    _reset: function () {
        this.size = this._renderer._bounds.getSize();
        this._update();
    },

    _update: function () {
        this.clear();
        if (this.data) {
            var ctx = this._renderer._ctx;
            var geoData = this.data.geoData;
            var options = this.options;
            for (var i = 0; i < geoData.length; i++) {
                var item = geoData[i];
                ctx.beginPath();
                ctx.lineWidth = this.options.lineWidth;
                ctx.lineJoin = "round";
                for (var j = 0; j < item.latlngs.length; j++) {
                    var pj = this._map.latLngToLayerPoint([item.latlngs[j][1], item.latlngs[j][0]]);
                    ctx[j===0?'moveTo':'lineTo'](pj.x, pj.y);
                    if(options.gradient && j>0){
                        var pj0 = this._map.latLngToLayerPoint([item.latlngs[j-1][1], item.latlngs[j-1][0]]);
                        var gradient = ctx.createLinearGradient(pj0.x, pj0.y, pj.x, pj.y);
                        gradient.addColorStop(0, getColor(item.start));
                        gradient.addColorStop(1, getColor(item.end));
                        ctx.strokeStyle = gradient;
                        ctx.stroke();
                    }
                }
                if(!options.gradient){
                    ctx.strokeStyle = getColor(item.value);
                    ctx.stroke();
                }

            }
        }

        function getColor(value) {
            return Sun.Util.LegendData.getColorOfRangeLegend(options.legendData, value)
        }
    },

    _containsPoint: L.Util.falseFn
});

/**
 * @class LW.TrafficLayer
 * @constructor
 * @param roadData {Array} 道路数据
 * @param options {object} 外部属性，可重设Properties
 * @returns {LW.TrafficLayer}
 */
LW.trafficLayer = function (roadData, options) {
    return new LW.TrafficLayer(roadData, options);
};

/**
 * @module Map
 */

/**
 * 地图经纬提示工具
 *
 * Features :
 *      1. 显示当前鼠标经纬
 *      2. 显示当前地图中心经纬
 *
 * @class L.Control.MousePosition
 * @extends L.Control
 * @example
 *          L.control.mousePosition({prefix:'鼠标所在位置：'}).addTo(map);
 */

L.Control.MousePosition = L.Control.extend({
    options: {
        /**
         * 显示位置
         * @property position
         * @type {string}
         * @default 'bottomright'
         */
        position: 'bottomright',

        /**
         * 显示分隔符
         * @property separator
         * @type {string}
         * @default ' : '
         */
        separator: ' : ',

        emptyString: 'Unavailable',

        /**
         * 是否经度在前显示
         * @property lngFirst
         * @type {boolean}
         * @default false
         */
        lngFirst: false,

        /**
         * 经纬度保留几位小数
         * @property numDigits
         * @type {int}
         * @default 5
         */
        numDigits: 5,

        /**
         * 经度格式
         * @property lngFormatter
         * @type {string}
         * @default undefined
         */
        lngFormatter: undefined,

        /**
         * 经度格式
         * @property latFormatter
         * @type {string}
         * @default undefined
         */
        latFormatter: undefined,

        /**
         * 显示前缀
         * @property prefix
         * @type {string}
         * @default ''
         */
        prefix: "鼠标位置：",

        centerPrefix:'地图中心：',

        elevationPrefix:'海拔高度：'
    },

    /**
     * @method setElevationModel
     * @param model {LW.GridModel}
     */
    setElevationModel:function (model) {
        this.elevationModel = model;
    },

    onAdd: function (map) {
        this._container = L.DomUtil.create('div', 'leaflet-control-mouseposition');
        this._mousePosition = L.DomUtil.create('p');
        this._container.appendChild(this._mousePosition);
        this._centerPosition = L.DomUtil.create('p');
        this._container.appendChild(this._centerPosition);
        this._elevation = L.DomUtil.create('p');
        this._container.appendChild(this._elevation);
        L.DomEvent.disableClickPropagation(this._container);
        map.on('mousemove', this._onMouseMove, this);
        map.on('drag', this._onCenterChange, this);
        map.on('zoomend', this._onCenterChange, this);
        //this._container.innerHTML=this.options.emptyString;
        return this._container;
    },

    onRemove: function (map) {
        map.off('mousemove', this._onMouseMove)
    },

    _onMouseMove: function (e) {
        // 当前鼠标经纬
        var lng = this.options.lngFormatter ? this.options.lngFormatter(e.latlng.lng) : L.Util.formatNum(e.latlng.lng, this.options.numDigits);
        var lat = this.options.latFormatter ? this.options.latFormatter(e.latlng.lat) : L.Util.formatNum(e.latlng.lat, this.options.numDigits);
        var value = this.options.lngFirst ? lng + this.options.separator + lat : lat + this.options.separator + lng;
        this._mousePosition.innerText = this.options.prefix + ' ' + value;
        // 当前鼠标海拔
        if(this.elevationModel){
            var rank = this.elevationModel.getClosestGridByLatlng(L.latLng(lat,lng));
            var elevation = this.elevationModel.getGrid(rank.row,rank.column) || '';
            elevation = elevation!=''?Sun.Util.Math.toRoundFixed(elevation,2):'';
            this._elevation.innerText = this.options.elevationPrefix + ' ' + elevation+'米';
        }
    },
    _onCenterChange: function (e) {
        var latlng = this._map.getCenter();
        var lng = this.options.lngFormatter ? this.options.lngFormatter(latlng.lng) : L.Util.formatNum(latlng.lng, this.options.numDigits);
        var lat = this.options.latFormatter ? this.options.latFormatter(latlng.lat) : L.Util.formatNum(latlng.lat, this.options.numDigits);
        var value = this.options.lngFirst ? lng + this.options.separator + lat : lat + this.options.separator + lng;
        this._centerPosition.innerText = this.options.centerPrefix + ' ' + value;
    }

});

L.Map.mergeOptions({
    positionControl: false
});

L.Map.addInitHook(function () {
    if (this.options.positionControl) {
        this.positionControl = new L.Control.MousePosition();
        this.addControl(this.positionControl);
    }
});

L.control.mousePosition = function (options) {
    return new L.Control.MousePosition(options);
};

/*
 * Extends L.Map to synchronize the interaction on one map to one or more other maps.
 */

(function () {
    'use strict';

    L.Map = L.Map.extend({
        sync: function (map, options) {
            this._initSync();
            options = options || {};

            // prevent double-syncing the map:
            var present = false;
            this._syncMaps.forEach(function (other) {
                if (map === other) {
                    present = true;
                }
            });

            if (!present) {
                this._syncMaps.push(map);
            }

            if (!options.noInitialSync) {
                map.setView(this.getCenter(), this.getZoom(), {
                    animate: false,
                    reset: true
                });
            }
            return this;
        },

        // unsync maps from each other
        unsync: function (map) {
            var self = this;

            if (this._syncMaps) {
                this._syncMaps.forEach(function (synced, id) {
                    if (map === synced) {
                        self._syncMaps.splice(id, 1);
                    }
                });
            }

            return this;
        },

        // overload methods on originalMap to replay on _syncMaps;
        _initSync: function () {
            if (this._syncMaps) {
                return;
            }
            var originalMap = this;

            this._syncMaps = [];

            L.extend(originalMap, {
                setView: function (center, zoom, options, sync) {
                    if (!sync) {
                        originalMap._syncMaps.forEach(function (toSync) {
                            toSync.setView(center, zoom, options, true);
                        });
                    }
                    return L.Map.prototype.setView.call(this, center, zoom, options);
                },

                panBy: function (offset, options, sync) {
                    if (!sync) {
                        originalMap._syncMaps.forEach(function (toSync) {
                            toSync.panBy(offset, options, true);
                        });
                    }
                    return L.Map.prototype.panBy.call(this, offset, options);
                },

                _onResize: function (event, sync) {
                    if (!sync) {
                        originalMap._syncMaps.forEach(function (toSync) {
                            toSync._onResize(event, true);
                        });
                    }
                    return L.Map.prototype._onResize.call(this, event);
                }
            });

            // originalMap.on('zoomend', function () {
            // originalMap._syncMaps.forEach(function (toSync) {
            //     toSync.setView(originalMap.getCenter(), originalMap.getZoom(), {
            //         animate: false,
            //         reset: false
            //     });
            // });
            // }, this);

            originalMap.dragging._draggable._updatePosition = function () {
                L.Draggable.prototype._updatePosition.call(this);
                var self = this;
                originalMap._syncMaps.forEach(function (toSync) {
                    L.DomUtil.setPosition(toSync.dragging._draggable._element, self._newPos);
                    // toSync.eachLayer(function (l) {
                    //     if (l._google !== undefined) {
                    //         l._google.setCenter(originalMap.getCenter());
                    //     }
                    // });
                    // toSync.fire('moveend');
                });
            };
            originalMap.dragging._draggable._onUp = function (e) {
                L.Draggable.prototype._onUp.call(this,e);
                originalMap._syncMaps.forEach(function (toSync) {
                    toSync.fire('moveend');
                });
            };
        }
    });
})();

/**
 * Worker任务,处理各个需要分线程计算的任务
 * Features :
 *      1. getArea--计算色斑图面积
 *
 * Update Note：
 *      + v1.4.3 ：Created
 *
 * @class LW.WorkerTask
 * @extends L.Class
 */
LW.WorkerTask = L.Class.extend({
    options:{
    },

    workers : {},

    initialize:function () {

    },

    _getWorkerUrl:function(wKey){
        return LW.workerPath + wKey + '.js';
    },

    _getWorker:function(wKey){
        return this.workers[wKey] = this.workers[wKey] || new Worker(this._getWorkerUrl(wKey));
    },

    /**
     * 根据色谱获取的色斑图的面积（单位：平方米）
     * @param lineData
     * @param mask
     * @param legendData
     * @return {Promise<any>}
     */
    getArea:function (lineData,mask,legendData) {
        // 重置图例面积
        legendData.forEach(function (item) { item.area = 0; });
        // 用worker area.js计算
        var worker = this._getWorker('area');
        return new Promise(function (resolve, reject) {
            worker.postMessage({
                libPrefix:LW.workerLibPath,
                lineData:lineData,
                mask:mask,
                legendData:legendData
            });
            worker.onmessage = function (a) {
                resolve(a.data);
            };
        });
    }
});

LW.WorkerTask = LW.WorkerTask.prototype;
LW.WorkerTask.initialize();
