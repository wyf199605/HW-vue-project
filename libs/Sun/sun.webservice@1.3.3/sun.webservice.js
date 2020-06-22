window.SW = Sun.Webserice = {
    version:'1.3.3',
    Rpc:{},
    Proxy:{},
    Rpc3_0:{}
};

function expose() {
    var oldSun = window.SW;

    SW.noConflict = function () {
        window.SW = oldSun;
        return this;
    };

    window.SW = SW;
}

// define Sun for Node module pattern loaders, including Browserify
if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = SW;

// define Sun as an AMD module
} else if (typeof define === 'function' && define.amd) {
    define(SW);
}

// define Sun as a global Sun variable, saving the original Sun to restore later if needed
if (typeof window !== 'undefined') {
    expose();
}

/**
 * SW.Promise
 *
 * Features :
 *      1. XMLHttpRequest获取数据以promise方式返回
 *      2. 支持GET和POST
 *      3. 支持所有XMLHttpRequest的返回类型
 *
 * Update Note：
 *      + v1.3.0 ：Created
 *      + v1.3.3 : 增加编码类型可配置的支持
 *
 * @class Sun.Ws2_1XHRInvoker
 */
SW.Promise = Sun.Class.extend({
    create:function (url,type,param,returntype,loadingTip,encodeType) {
        type = type || 'GET';
        returntype = returntype || 'json';
        var xhr = new XMLHttpRequest();
        var isIE = Sun.Util.Common.isIE();
        var promise = new Promise(function (resolve, reject) {
            if(loadingTip && loadingTip.show) loadingTip.show();
            xhr.open(type, url, true);
            if(!isIE || returntype == 'arraybuffer')
                xhr.responseType = returntype;
            xhr.onload = function () {
                if (xhr.status === 200) {
                    var data = this.response;
                    if(isIE)
                        data = returntype == 'json' ? JSON.parse(data) : data;
                    resolve(data);
                } else {
                    if(reject) reject(new Error(xhr.statusText));
                }
            };
            xhr.onerror = function () {
                if(reject) reject(new Error(xhr.statusText));
            };
            xhr.onloadend = function (e) {
                if (loadingTip && loadingTip.hide) loadingTip.hide();
            };
            xhr.onabort = function (e) {
                if (loadingTip && loadingTip.hide) loadingTip.hide();
                if(reject) reject();
                // Promise.reject(new Error('abort')).then(resolve, reject);
            };
            if(encodeType)
                xhr.overrideMimeType("text/html;charset="+encodeType);//以设定的编码识别数据，不支持ie
            xhr.send(param);
        });
        // .catch(function (reason) { // Tip:加了这个导致promise变化。虽然不报错，但是结果似乎不对
        // });
        promise.xhr = xhr;
        return promise;
    },

    create_shp:function (url) {
        return new Promise(function (resolve, reject) {
            shp(url).then(function (data) {
                resolve(data);
            });
        });
    }
});

SW.Promise = SW.Promise.prototype;

SW.Ws2_1Invoker = Sun.Class.extend({

    /**
     * ajax访问数据
     * @method invoke
     * @param method {string} 接口名
     * @param version {int} 接口版本号
     * @param params {string} 参数
     * @param successFun {function} 访问成功回调
     * @param errorFun {function} 访问错误回调
     * @param addToLoading {boolean} 是否显示loading tip
     * @param options
     * @protected
     * @returns {*}
     */
    invoke: function (method, params, version, successFun, errorFun, addToLoading,options) {
        version = version || 1;
        addToLoading = addToLoading == undefined ? true : addToLoading;
        var data;
        var url = this.getUrl(options.rootURL, method,options.returntype, version, params);
        var debug = options.debug;
        var waitingTip = options.waitingTip;
        var tipMode = options.tipMode;
        if (waitingTip && addToLoading) {
            if (waitingTip.show) waitingTip.show();
            if (tipMode == 'multi') SW.Rpc.loadings.push(method);
        }
        var dataType = options.dataType || 'json';
        this._ajax = $.ajax({
            type: "get", //访问类型
            async: true, //是否异步
            dataType: dataType, //返回类型
            // jsonp: "jsoncallback",
            url: url,
            success: function (result) {
                if (debug && window.console)
                    console.debug('[success]: ' + url);
                if (Sun.Util.Common.isValid(result)) {
                    data = result.FieldName ? result : (result.Rows || result);
                    if (data&&successFun) successFun(data);
                }
            },
            error: function () {
                if (debug && window.console)
                    console.error('[error]: ' + url);
                if (errorFun)
                    errorFun();
            },
            complete: function () {
                if (tipMode == 'multi') {
                    var methodIndex = SW.Rpc.loadings.indexOf(method);
                    if (methodIndex != -1)
                        SW.Rpc.loadings.splice(methodIndex, 1);
                    if (waitingTip && SW.Rpc.loadings.length == 0)
                        if (waitingTip.hide) waitingTip.hide();
                }
                else if (waitingTip.hide) waitingTip.hide();
            }
        });
        return this._ajax;
    },

    /**
     * 停止自身代理的数据调用
     * @method close
     */
    close: function () {
        if (this._ajax) this._ajax.abort();
    },

    getUrl: function (rootUrl, method, returntype, version, params) {
        var iquery = "iquery=" + method + "|" + String(version);
        if (params) {
            for (var i = 0; i < params.length; i++) {
                iquery += "|" + this._getType(params[i]) + ";" + this._getStringValue(params[i]);
            }
        }
        var tk = new Date().getTime();
        return rootUrl + "?projectname=&calltype="+returntype+"&" + iquery+"&tk="+tk;
    },

    _getType : function (value) {
        var s = 'String';
        var type = typeof(value);
        if (type == "number") {
            var f = Math.floor(value);
            s = f == value ? 'Int32' : 'Decimal';
        }
        else if (type == 'boolean')
            s = 'Boolean';
        else if (value instanceof Date)
            s = 'DateTime';
        else if (value instanceof Double)
            s = 'Double';
        else if (value instanceof Decimal)
            s = 'Decimal';
        else if (Uint8Array && value instanceof Uint8Array || Uint16Array && value instanceof Uint16Array)
            s = 'Byte[]';
        return s;
    },

    _getStringValue : function (value) {
        if (value instanceof Array)
            return value.join(',');
        else if (value instanceof Date)
            return value.format('yyyy/MM/dd hh:mm:ss');
        else if (value instanceof Double || value instanceof Decimal)
            return String(value.value);
        else
            return String(value);
    }
});

SW.ws2_1Invoker = function(options){
    return new SW.Ws2_1Invoker(options);
};

/**
 * web service 2.1 Post 数据代理
 *
 * Features :
 *      1. Post方式取数
 *      2. 可取流文件和json文件
 *
 * Update Note：
 *      + v1.2.0 ：Created
 *      + v1.3.2 : IE兼容性的修改
 *
 *
 * @class Sun.Ws2_1XHRInvoker
 */

SW.Ws2_1XHRInvoker = SW.Ws2_1Invoker.extend({
    options:{
        type:'POST'
    },

    initialize: function (options) {
        Sun.setOptions(this, options);
    },

    /**
     * ajax访问数据
     * @method invoke
     * @param method {string} 接口名
     * @param version {int} 接口版本号
     * @param params {string} 参数
     * @param successFun {function} 访问成功回调
     * @param errorFun {function} 访问错误回调
     * @param addToLoading {boolean} 是否显示loading tip
     * @param options
     * @protected
     * @returns {*}
     */
    invoke: function (method, params, version, successFun, errorFun, addToLoading, options) {
        version = version || 1;
        addToLoading = addToLoading == undefined ? true : addToLoading;
        var type = this.options.type;
        var returntype = options.returntype,calltype = options.calltype;
        this.url = this.getUrl(options.rootURL, method,options.returntype, version, params);
        var url = type=='GET'?this.url:this.getPostUrl(options.rootURL, calltype, returntype);
        var debug = options.debug;
        var waitingTip = options.waitingTip;
        var tipMode = options.tipMode;
        if (waitingTip && addToLoading) {
            if (waitingTip.show) waitingTip.show();
            if (tipMode == 'multi') SW.Rpc.loadings.push(method);
        }
        try {
            var isIE = Sun.Util.Common.isIE();
            var xhr = this.xhr = new XMLHttpRequest();
            xhr.open(type, url, true);
            if(!isIE || returntype == 1)
                xhr.responseType = this._getReturnType(returntype);
            xhr.onload = function (e) {
                if (debug && window.console)
                    console.debug('[success]: ' + url);
                if(returntype==1)
                    successFun(this.response);
                else{
                    var data = this.response;
                    if(isIE)
                        data = returntype == 4 ? JSON.parse(data) : data;
                    if (Sun.Util.Common.isValid(data)) {
                        data = data.Rows || data;
                        if (data&&successFun) successFun(data);
                    }
                    else if (errorFun) errorFun();
                }

            };
            xhr.onerror = function (e) {
                if (debug && window.console)
                    console.error('[error]: ' + url);
                if (errorFun)
                    errorFun();
            };
            xhr.onloadend = function (e) {
                if (debug && window.console && type == 'POST'){
                    var p_info = '';
                    params.forEach(function (item) {
                        p_info+=(item instanceof Uint8Array || item instanceof Uint16Array?'[Byte]':item)+'|';
                    });
                    console.info('[post]: ' + method + '|' + version + '|' + p_info);

                }
                if (tipMode == 'multi') {
                    var methodIndex = SW.Rpc.loadings.indexOf(method);
                    if (methodIndex != -1)
                        SW.Rpc.loadings.splice(methodIndex, 1);
                    if (waitingTip && SW.Rpc.loadings.length == 0)
                        if (waitingTip.hide) waitingTip.hide();
                }
                else if (waitingTip.hide) waitingTip.hide();
            };

            var param = type=='GET'?null:
                (calltype==4?this._getParamOfBuffer(method,version,params):this._getParamOfJson(method,version,params));
            xhr.send(param);
        }
        catch (e) {
            console.log(e);
        }
        return this;
    },

    /**
     * 停止自身代理的数据调用
     * @method close
     */
    close: function () {
        if (this.xhr) this.xhr.abort();
    },

    getPostUrl: function (rootUrl, calltype, returntype) {
        return rootUrl + "?projectname=&calltype="+calltype+"&returntype=" + returntype;
    },

    _getReturnType:function (key) {
        if(key==1)
            return 'arraybuffer';
        else if(key==4)
            return 'json';
    },

    _getParamOfJson: function (method,version,params) {
        var json = {"Version" :"2.1","Function":{"Name":method,"Version":version.toString()},"Params":[]};
        if (params) {
            for (var i = 0; i < params.length; i++) {
                var p = typeof params[i] != 'undefined' ? params[i] : '';
                var type = this._getType(p);
                if(type == 'Byte[]')
                    p=Array.from(p);
                else if (p instanceof Date)
                    p=p.format('yyyy/MM/dd hh:mm:ss');
                else if (p instanceof Double || p instanceof Decimal)
                    p = p.value;
                json.Params.push({"Type":type,"Value":p});
            }
        }
        return JSON.stringify(json);
    },

    _getParamOfBuffer:function (method,version,params) {
        var ioBuffer = new Sun.IOBuffer(1024 * 300);
        ioBuffer.writeInt32(method.length);
        ioBuffer.writeChars(method);
        version = version.toString();
        ioBuffer.writeInt32(version.length);
        ioBuffer.writeChars(version);
        ioBuffer.writeInt32(params.length);
        if (params) {
            for (var i = 0; i < params.length; i++) {
                var p = typeof params[i] != 'undefined' ? params[i] : '';
                var type = this._getType(p);
                ioBuffer.writeInt32(type.length);
                ioBuffer.writeChars(type);
                if (p instanceof Date)
                    p = p.format('yyyy/MM/dd hh:mm:ss');
                var writer = this._getWriter(ioBuffer, p);
                var len = typeof p == "string" ? Sun.Util.Data.strToUnicode(p).length :
                    (typeof(p) == "number" ? 4 : (p instanceof Double ? 8 : p.length));
                ioBuffer.writeInt32(len);
                writer.call(ioBuffer, p instanceof Double || p instanceof Decimal ? p.value : p);
            }
        }
        return ioBuffer.buffer;
    },

    _getWriter : function (ioBuffer,value) {
        var writer = ioBuffer.writeChars;
        var type = typeof(value);
        if (type == "number") {
            var f = Math.floor(value);
            writer = f == value ? ioBuffer.writeInt32 : ioBuffer.writeFloat32;
        }
        else if(value instanceof Double || value instanceof Decimal)
            writer = ioBuffer.writeFloat32;
        else if (value instanceof Uint8Array)
            writer = ioBuffer.writeBytes;
        return writer;
    }
});

SW.ws2_1XHRInvoker = function(options){
    return new SW.Ws2_1XHRInvoker(options);
};

/**
 * web service 2.1 Promise 数据代理
 *
 * Features :
 *      1. 采用Promise做异步调用
 *
 * Update Note：
 *      + v1.3.0 ：Created
 *
 *
 * @class Sun.Ws2_1_Promise
 */

SW.Ws2_1_Promise = SW.Ws2_1XHRInvoker.extend({
    options:{
        type:'GET'
    },

    /**
     * ajax访问数据
     * @method invoke
     * @param method {string} 接口名
     * @param version {int} 接口版本号
     * @param params {string} 参数
     * @param successFun {function} 访问成功回调
     * @param errorFun {function} 访问错误回调
     * @param addToLoading {boolean} 是否显示loading tip
     * @param options
     * @protected
     * @returns {*}
     */
    invoke: function (method, params, version, successFun, errorFun, addToLoading, options) {
        version = version || 1;
        var type = this.options.type;
        var returntype = options.returntype,calltype = options.calltype;
        this.url = this.getUrl(options.rootURL, method,options.returntype, version, params);
        var url = type=='GET'?this.url:this.getPostUrl(options.rootURL, calltype, returntype);
        var param = type=='GET'?null:
            (calltype==4?this._getParamOfBuffer(method,version,params):this._getParamOfJson(method,version,params));
        var promise = SW.Promise.create(url,type,param,this._getReturnType(returntype),options.waitingTip);

        promise.finally(function () {
            if (options.debug && window.console){
                console.debug('[URL]: ' + url);
                if(type == 'POST'){
                    var p_info = '';
                    params.forEach(function (item) {
                        p_info+=(item instanceof Uint8Array || item instanceof Uint16Array?'[Byte]':item)+'|';
                    });
                    console.debug('[POST]: ' + method + '|' + version + '|' + p_info);
                }
            }
        });

        return promise;
    },

    /**
     * 停止自身代理的数据调用
     * @method close
     */
    close: function (promise) {
        if (promise.xhr) promise.xhr.abort();
    }
});

SW.ws2_1_Promise = function(options){
    return new SW.Ws2_1_Promise(options);
};

SW.Ws_Promise = SW.Ws2_1_Promise;
SW.ws_Promise = SW.ws2_1_Promise;

/**
 * web service 3.0 Promise 数据代理
 *
 * Features :
 *      1. 采用Promise做异步调用
 *
 * Update Note：
 *      + v1.3.0 ：Created
 *      + v1.3.2 : IE兼容性的修改
 *
 *
 * @class Sun.Ws_Promise
 */

SW.Ws3_0_Promise = Sun.Class.extend({
    options:{
        /**
         * 取数类型
         *
         * 说明：
         *    + GET：通过地址带有参数信息直接GET获取
         *    + POST：通过POST参数的形式获取
         */
        type:'GET',
        /**
         * options.type为POST时使用
         *
         * 说明：
         *    + json：Json格式
         *    + stream：二进制自定义流格式
         *
         * @property calltype
         * @type {string}
         * @default 'json'
         */
        callType:'json',

        /**
         * 返回数据类型，支持XMLHttpRequest原生支持的类型
         *
         * 说明：
         *    + json：返回json数据
         *    + arraybuffer：返回流数据
         *
         * @property returntype
         * @type {number}
         * @default 'json'
         */
        returnType:'json'
    },

    initialize: function (options) {
        Sun.setOptions(this, options);
    },

    /**
     * ajax访问数据
     * @method invoke
     * @param method {string} 接口名
     * @param version {string} 接口版本号
     * @param params {string} 参数
     * @param returnType {String} [optional] 返回类型，如不穿则默认为options中的returnType
     * @param options
     * @protected
     * @returns {*}
     */
    invoke: function (method, version, params, returnType, options) {
        var type = this.options.type;
        var baseParams = this._getBaseParams(method,version,params,options);
        var url = this.url = type=='GET'?this.getUrl(baseParams,params,options):this.getPostUrl(options);
        var param = type=='GET'?null:this._getParamsOfPOST(baseParams);
        var promise = SW.Promise.create(url,type,param,returnType||this.options.returnType,options.loadingTip);

        promise.finally(function () {
            if (options.debug && window.console){
                console.debug('[URL]: ' + url);
                if(type == 'POST')
                    console.debug('[POST]: ',baseParams,params);
            }
        });

        return promise;
    },

    /**
     * 停止自身代理的数据调用
     * @method close
     */
    close: function (promise) {
        if (promise.xhr) promise.xhr.abort();
    },

    _getBaseParams:function(method, version, params, options){
        var p = {user:options.user,password:options.password,version:options.version};
        if(this.options.type === 'GET'){
            p.funname = method;
            p.funversion = version;
        }
        else {
            p.fun = {name: method, version: version};
            var _params = {};
            for(var key in params){
                var param = params[key];
                _params[key] = param instanceof Date ? param.format('yyyy-MM-dd hh:mm:ss') : param;
            }
            p.params = _params;
        }
        return p;
    },

    getUrl: function (baseParams,params,options) {
        var _params = getParamStr(baseParams) + getParamStr(params);
        _params = _params.slice(1);
        return options.rootURL + "?" + _params;

        function getParamStr(params) {
            var str = '';
            for(var key in params){
                var param = params[key];
                param =  param instanceof Date ? param.format('yyyy-MM-dd hh:mm:ss') : param;
                str += '&' + key + '=' + param;
            }
            return str;
        }
    },

    getPostUrl: function (options) {
        return options.rootURL + '?calltype=' + this.options.callType;
    },

    _getParamsOfPOST: function (baseParams) {
        return this.options.callType === 'json' ? JSON.stringify(baseParams) : this._getParamsOfBuffer(baseParams);
    },

    _getParamsOfBuffer:function (baseParams) {
        var ioBuffer = new Sun.IOBuffer(1024 * 300);
        for(var key in baseParams){
            var value = baseParams[key];
            if(Object.prototype.toString.call(value) === "[object Object]"){//object 对象
                for(var k in value){
                    var p = value[k];
                    var writer = this._getWriter(ioBuffer,p);
                    // ioBuffer.writeInt32(typeof(p) == "number"?4:(p instanceof Double?8:p.length));
                    var len = typeof p == "string" ? Sun.Util.Data.strToUnicode(p).length :
                        (typeof(p) == "number" ? 4 : (p instanceof Double ? 8 : p.length));
                    ioBuffer.writeInt32(len);
                    writer.call(ioBuffer,p instanceof Double? p.value : p);
                }
            }
            else{
                ioBuffer.writeInt32(value.length);
                ioBuffer.writeChars(value);
            }
        }
        return ioBuffer.buffer;
    },

    _getWriter : function (ioBuffer,value) {
        var writer = ioBuffer.writeChars;
        var type = typeof(value);
        if (type == "number") {
            var f = Math.floor(value);
            writer = f == value ? ioBuffer.writeInt32 : ioBuffer.writeFloat32;
        }
        else if(value instanceof Double)
            writer = ioBuffer.writeFloat32;
        else if (value instanceof Uint8Array)
            writer = ioBuffer.writeBytes;
        return writer;
    }
});

SW.ws3_0_Promise = function(options){
    return new SW.Ws3_0_Promise(options);
};

/**
 * web service restful 3.0 Promise 数据代理
 *
 * Features :
 *      1. 采用Promise做异步调用
 *
 * Update Note：
 *      + v1.3.3 ：Created
 *
 *
 * @class Sun.WsRest3_0_Promise
 */

SW.WsRest3_0_Promise = SW.Ws3_0_Promise.extend({
    options:{
    },

    /**
     * ajax访问数据
     * @method invoke
     * @param method {string} 接口名
     * @param version {string} 接口版本号
     * @param params {string} 参数
     * @param returnType {String} [optional] 返回类型，如不穿则默认为options中的returnType
     * @param options
     * @protected
     * @returns {*}
     */
    invoke: function (method, version, params, returnType, options) {
        var type = this.options.type;
        var url = this.url = this.getUrl(type=='GET',method,version,params,options);
        var param = type=='GET'?null:this._getParamsOfPOST(params,options);
        var promise = SW.Promise.create(url,type,param,returnType||this.options.returnType,options.loadingTip);

        promise.finally(function () {
            if (options.debug && window.console){
                console.debug('[URL]: ' + url);
            }
        });

        return promise;
    },

    getUrl: function (get,method,version,params,options) {
        var _params = getParamStr(get ?params:{calltype:this.options.callType});
        _params = _params.slice(1);
        return options.rootURL + method + '_v' + version + '?' + _params;

        function getParamStr(params) {
            var str = '';
            for (var key in params) {
                var param = params[key];
                param = param instanceof Date ? param.format('yyyy-MM-dd hh:mm:ss') : param;
                str += '&' + key + '=' + param;
            }
            return str;
        }
    },

    _getParamsOfPOST: function (params, options) {
        var p = {user:options.user,password:options.password,version:options.version};
        var _params = {};
        for(var key in params){
            var param = params[key];
            _params[key] = param instanceof Date ? param.format('yyyy-MM-dd hh:mm:ss') : param;
        }
        p.params = _params;
        return this.options.callType === 'json' ? JSON.stringify(p) : this._getParamsOfBuffer(p);
    }
});

SW.wsRest3_0_Promise = function(options){
    return new SW.WsRest3_0_Promise(options);
};

SW.Rpc.loadings = [];
/**
 * web service 2.1 数据代理
 *
 * Features :
 *      1. 多个接口属于一个proxy
 *      2. Ajax为核心取数方式
 *
 * Update Note：
 *      + 2016.7 ：Created
 *      + v1.2.0 ：1.删除options中version属性，在所有的接口的success回调参数前加入version参数
 *                 2.将ajax get json 取数方式移入SW.Ws2_1Invoker
 *                 3.将日期格式改为yyyy/MM/dd hh:mm:ss
 *
 * @class Sun.BaseProxy
 */
SW.Rpc.BaseProxy = Sun.Class.extend({
    options: {

        /**
         * webservice 根地址
         * @property rootURL
         * @type {string}
         * @default ''
         */
        rootURL: '',

        /**
         * webservice 服务地址  eg: .net--'/Weather/ZDZ.aspx',java--'/Weather/ZDZ'
         * @property serviceUrl
         * @type {string}
         * @default ''
         */
        serviceUrl: '',

        /**
         * 访问数据类型,一般为post时使用
         *
         * 说明：
         *    + 1：xml方式（post流为自定义格式）
         *    + 2：自定义流方式
         *    + 3：xml方式（post流为普通格式）
         *    + 4：普通流方式（每项流包含长度）
         *    + 5：json
         *
         * @property calltype
         * @type {number}
         * @default 4
         */
        calltype: 4,

        /**
         * 返回数据类型
         * 注：在get时当做calltype拼凑地址使用，因为当时数据组这个calltype、returntype用错的
         *
         * 说明：
         *    + 1：普通流返回
         *    + 2：压缩流返回
         *    + 3：xml文本返回
         *    + 4：json文本返回
         *    + 5：精简json返回
         *
         * @property returntype
         * @type {number}
         * @default 4
         */
        returntype: 4,

        /**
         * loading tip 等待提示
         *
         * 传入对象需含有show and hide 方法，如$('#id-name')/$('.class-name')
         *
         * @property waitingTip
         * @default null
         */
        waitingTip: null,

        /**
         * 显示 loading tip 的模式，选项如下:
         *    1. single : 单个proxy加载完毕即关闭loading tip
         *    2. multi  : 所有proxy加载完毕才关闭loading tip
         * @property tipMode
         * @type {string}
         * @default multi
         */
        tipMode: 'multi',

        /**
         * 是否为调试状态，调试状态下将会打印加载数据信息
         *
         * 注意：在系统正式运行时必需将此属性设为false
         *
         * @property debug
         * @type {boolean}
         * @default false
         */
        debug: false,

        /**
         * webservice
         * @property ws
         * @default SW.ws2_1Invoker()
         */
        ws: SW.ws2_1Invoker()
    },



    initialize: function (options) {
        Sun.setOptions(this, options);
        this.options.rootURL += this.options.serviceUrl;
    },

    /**
     * ajax访问数据
     * @method invoke
     * @param method {string} 接口名
     * @param version {int} 接口版本号
     * @param params {string} 参数
     * @param successFun {function} 访问成功回调
     * @param errorFun {function} 访问错误回调
     * @param addToLoading {boolean} 是否显示loading tip
     * @protected
     * @returns {*}
     */
    invoke: function (method, params, version, successFun, errorFun, addToLoading) {
        return this.options.ws.invoke(method, params, version, successFun, errorFun, addToLoading,this.options);
    },

    /**
     * 停止自身代理的数据调用
     * @method close
     */
    close: function () {
        this.options.ws.close();
    }
});
/**
 * 数据库 数据代理
 *
 * 用sql语句直接向数据库取数
 * @class Sun.DbProxy
 * @extends Sun.BaseProxy
 */
SW.Rpc.DbProxy = SW.Rpc.BaseProxy.extend({
    options:{
        serviceUrl: '/DB.aspx'
    },


    /**
     * 根据sql语句来获取数据列表
     * @method db_getDataTable
     * @param constr {string} 数据库库名
     * @param sql {string} sql语句
     * @param pageCount {Date} 默认填写-1
     * @param pageIndex {Date} 默认填写-1
     * @param version {int} 接口版本
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    db_getDataTable: function (constr, sql, pageCount, pageIndex, version, successFun, errorFun) {
        var params = [];
        params = params.concat(constr, sql, pageCount, pageIndex);
        return this.invoke("DB.GetDataTable", params, version, successFun, errorFun);
    },

    //-->内存库接口
    //   说明：
    //   1. 接口就几个，主要通过内存key的变化来获取不同的数据
    //   2. 暂时只支持用post方法获取，get方法并未完整支持

    /**
     * 通过内存key获取数据内容
     * @param params {Array} 参数
     * @param version {int} 接口版本 1：参数为1个，就一个key. 2:参数为2个，主key和备用key.
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     */
    redis_getDataContentByRedisKey: function (params,version,successFun, errorFun) {
        return this.invoke("REDIS.GetDataContentByRedisKey", params, version, successFun, errorFun);
    },

    /**
     * 通过制定key获取NC数据流，无数据自动向前推移2个时次
     * @param params
     * @param version
     * @param successFun
     * @param errorFun
     */
    redis_GetDataContentByElementInfo: function (params,version,successFun, errorFun) {
        return this.invoke("REDIS.GetDataContentByElementInfo", params, version, successFun, errorFun);
    },


    /**
     * 通过key获取内存库数据最后修改日期
     * @param key {string} 内存key
     * @param version {int} 接口版本
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     */
    redis_getDataTimeByRedisKey: function (key,version,successFun, errorFun) {
        var params = [key];
        return this.invoke("REDIS.GetDataTimeByRedisKey", params, version, successFun, errorFun);
    },

    /**
     * 将数据内容上传至内存数据库
     * @param key {string} 内存key
     * @param timeout {int} 存储时间
     * @param bytes {Uint8Array} 数据流
     * @param version {int} 接口版本
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     */
    redis_setDataContentToRedis: function (key,timeout,bytes,version,successFun, errorFun) {
        var params = [];
        params = params.concat(key,timeout,bytes);
        return this.invoke("REDIS.SetDataContentToRedis", params, version, successFun, errorFun);
    },

    /**
     * 将数据内容上传至内存数据库 并计算高低温矛盾验证，降水负值验证
     * @param key  {string} 保存的内存key
     * @param bytes  {Uint8Array} 保存的内容数据流
     * @param timeout {int} 存储时间
     * @param element {string} 要素类型(tmax24,tmin24,rain)
     * @param contraskey {string} 辅助验证内存key1（可为空）
     * @param backcontrakey {string} 辅助验证内存key2（在key1数据不存在的情况下用key2来验证，可为空）
     * @param version
     * @param successFun
     * @param errorFun
     */
    redis_setDataContentToRedis2: function (key,bytes,timeout,element,contraskey,backcontrakey,version,successFun, errorFun) {
        var params = [];
        params = params.concat(key,bytes,timeout,element,contraskey,backcontrakey);
        return this.invoke("REDIS.SetDataContentToRedis", params, version, successFun, errorFun);
    },

    /**
     * 将数据内容上传至内存数据库 并计算高低温矛盾验证，降水负值验证,验证后自动修正
     * @param key  {string} 保存的内存key
     * @param bytes  {Uint8Array} 保存的内容数据流
     * @param timeout {int} 存储时间
     * @param element {string} 要素类型(tmax24,tmin24,rain)
     * @param contraskey {string} 辅助验证内存key1（可为空）
     * @param backcontrakey {string} 辅助验证内存key2（在key1数据不存在的情况下用key2来验证，可为空）
     * @param adjustedValue 调整值
     * @param version
     * @param successFun
     * @param errorFun
     * @returns {*}
     */
    redis_setDataContentToRedis3: function (key,bytes,timeout,element,contraskey,backcontrakey,adjustedValue,version,successFun, errorFun) {
        var params = [];
        params = params.concat(key,bytes,timeout,element,contraskey,backcontrakey,adjustedValue);
        return this.invoke("REDIS.SetDataContentToRedis", params, version, successFun, errorFun);
    },

    /**
     * 根据经纬信息、要素信息、用户信息查询指定经纬数据
     * @param lon {number}
     * @param lat {number}
     * @param keyMode {string} eg:b_nc_fusion_{ele}_999_{yyyyMMddHH}_{aaa}
     * @param referenceKeyMode {string} eg:p_nc_ecthin_{ele}_999_{yyyyMMddHH}_{aaa}
     * @param refModeNames {string} eg:ecthin
     * @param elementName {string}
     * @param userName {string}
     * @param predictionTime {string}
     * @param startTimeSession {int}
     * @param endTimeSession {int}
     * @param version {int} 接口版本
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     */
    redis_getDataByLonLatAndEleInfoAndUserInfo: function (lon,lat,keyMode,referenceKeyMode,refModeNames,elementName,userName,predictionTime,startTimeSession,endTimeSession,version,successFun, errorFun) {
        var params = [];
        lon = new Double(lon);
        lat = new Double(lat);
        params = params.concat(lon,lat,keyMode,referenceKeyMode,refModeNames,elementName,userName,predictionTime,startTimeSession,endTimeSession);
        return this.invoke("REDIS.GetDataByLonLatAndEleInfoAndUserInfo", params, version, successFun, errorFun);
    },

    // 获取任意点多要素预报数据
    redis_getPluralDataByLonLatAndEleInfoAndUserInfo: function (lon,lat,keyMode,forecastMode,refKeyModes,refModeNames,elementNames,interval,userCode,predictionTime,startTimeSession,endTimeSession,version,successFun, errorFun) {
        var params = [];
        lon = new Double(lon);
        lat = new Double(lat);
        interval = parseInt(interval);
        params = params.concat(lon,lat,keyMode,forecastMode,refKeyModes,refModeNames,elementNames,interval,userCode,predictionTime,startTimeSession,endTimeSession);
        return this.invoke("REDIS.GetPluralDataByLonLatAndEleInfoAndUserInfo", params, version, successFun, errorFun);
    },

    // 任意区域--多要素查询最大、最小、平均
    // @param type {string} min/max/ave
    redis_getPluralDataByPolygonIndexAndEleInfoAndUserInfo: function (idxAndLen,type,keyMode,forecastMode,refKeyModes,refModeNames,elementNames,interval,userCode,predictionTime,startTimeSession,endTimeSession,version,successFun, errorFun) {
        var params = [];
        interval = parseInt(interval);
        params = params.concat(idxAndLen,type,keyMode,forecastMode,refKeyModes,refModeNames,elementNames,interval,userCode,predictionTime,startTimeSession,endTimeSession);
        return this.invoke("REDIS.GetPluralDataByPolygonIndexAndEleInfoAndUserInfo", params, version, successFun, errorFun);
    },

    // 获取任意点多要素预报数据
    redis_getOceanDataByLonLatAndEleInfoAndUserInfo: function (lon,lat,keyMode,forecastMode,refKeyModes,refModeNames,elementNames,interval,userCode,predictionTime,startTimeSession,endTimeSession,version,successFun, errorFun) {
        var params = [];
        lon = new Double(lon);
        lat = new Double(lat);
        interval = parseInt(interval);
        params = params.concat(lon,lat,keyMode,forecastMode,refKeyModes,refModeNames,elementNames,interval,userCode,predictionTime,startTimeSession,endTimeSession);
        return this.invoke("REDIS.GetOceanDataByLonLatAndEleInfoAndUserInfo", params, version, successFun, errorFun);
    },

    // 任意区域指定时效范围获取最大最小(海洋类型数据用)
    redis_getAreaDataExtremByElmentInfo: function (axis,userCode,keyMode,forecastMode,refKeyModes,refModeNames,predictionTime,elementNames,interval,startTimeSession,endTimeSession,version,successFun, errorFun) {
        var params = [axis];
        interval = parseInt(interval);
        params = params.concat(userCode,keyMode,forecastMode,refKeyModes,refModeNames,predictionTime,elementNames,interval,startTimeSession,endTimeSession);
        return this.invoke("REDIS.GetAreaDataExtremByElmentInfo", params, version, successFun, errorFun);
    },


    /**
     * 设置具体key的数据
     * @param key {string}
     * @param value {string}
     * @param version {int} 接口版本
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     */
    redis_setParametersValueByKey: function (key,value,version,successFun, errorFun) {
        var params = [];
        value = Sun.Util.Data.strToUnicodeArray(value);
        params = params.concat(key,value);
        return this.invoke("REDIS.SetParametersValueByKey", params, version, successFun, errorFun);
    },

    redis_getParametersValueByKey: function (key,version,successFun, errorFun) {
        return this.invoke("REDIS.GetParametersValueByKey", [key], version, successFun, errorFun);
    },

    /**
     * 根据内存key数据验证高温、低温、降水 是否超过历史极值
     * @param key {String} 存放数据的内存key
     * @param backkey {String} 备用存放数据的内存key，（在参数1数据不存在时，判断参数2的数据，参数2可为空）
     * @param month 格点数据的预报月份（int）（指这份数据预报时间的月份，不是指起报时间）
     * @param element 格点数据的要素 （tmax24，tmin24，rain24）
     * @param version
     * @param successFun 要素、格点的站点数据 eg：{"Element":"tmax24","Count":9456}
     * @param errorFun
     */
    redis_getExtremeValueStationCountByKey: function (key,backkey,month,element,version,successFun, errorFun) {
        var params = [];
        params = params.concat(key,backkey,month,element);
        return this.invoke("REDIS.GetExtremeValueStationCountByKey", params, version, successFun, errorFun);
    },

    /**
     * 多参考模式区域权重计算
     * @param keys {String} 需要做权重计算的key,用逗号隔开
     * @param weight {String} 权重，与上面的key对应，数量位置一致
     * @param indexAndLength {String} 索引和长度配对出现，比如15,3,30,5 代表，从索引为15（包含15）的开始取，向后3个数据，从30（包含30）开始取，向后5个
     * @param version
     * @param successFun
     * @param errorFun
     */
    redis_getNewDataByWeightingAndRedisKey: function (keys,weight,indexAndLength,version,successFun, errorFun) {
        var params = [];
        params = params.concat(keys,weight,indexAndLength);
        return this.invoke("REDIS.GetNewDataByWeightingAndRedisKey", params, version, successFun, errorFun);
    },

    /**
     * 判断参考数据指定起报、时效、要素是否存在
     * @param refKey {String} b_j_resources_key_list
     * @param elementCode {String} eg:rain/rain3
     * @param predictionTime {String} 格式：yyyyMMddHHmmss 20170831200000
     * @param timeSession {int}
     * @param version
     * @param successFun
     * @param errorFun
     */
    redis_getExistForecastIDByResoursListAndTimeInfo: function (refKey,elementCode,predictionTime,timeSession,version,successFun, errorFun) {
        var params = [];
        params = params.concat(refKey,elementCode,predictionTime,timeSession);
        return this.invoke("REDIS.GetExistForecastIDByResoursListAndTimeInfo", params, version, successFun, errorFun);
    },

    /**
     * 任意时段累积降水、最高温、最低温、最小能见度、最大风速 数据获取接口
     * @param userCode uhwadmin(北京uhwadmin的编码，其他地方根据实际情况)
     * @param keyMode b_nc_fusion_{ele}_999_{yyyyMMddHH}_{aaa}
     * @param predictionTime 格式：yyyyMMddHHmmss 20170831200000
     * @param elementCode 要素 （rain、10uv、vis、t2m）
     * @param type max\min\sum\ave 分别表示 最大、最小、和、平均
     * @param start {int|String} 起始时效（v1）|起始时间（v2）
     * @param end {int|String} 结束时效（v1）|结束时间（v2）
     * @param isReturn {String} 结束时效
     * @param version 版本
     * @param successFun 返回值 Byte[]
     * @param errorFun
     */
    redis_getSumOrExtremeDataContentByElementInfo: function (userCode,keyMode,predictionTime,elementCode,type,start,end,isReturn,version,successFun, errorFun) {
        var params = [];
        params = params.concat(userCode,keyMode,predictionTime,elementCode,type,start,end,isReturn);
        return this.invoke("REDIS.GetSumOrExtremeDataContentByElementInfo", params, version, successFun, errorFun);
    },

    /**
     * 获取多点多要素任意时段数据
     * @param lngs {String} 经度 (可以多个，用逗号隔开)
     * @param lats {String} 纬度 (可以多个，用逗号隔开，与经度一一对应)
     * @param userKeyMode {String} eg:u_nc_u47_{ele}_999_{yyyyMMddHH}_{aaa} 无用户可不填
     * @param keyMode {String} 模式 eg:b_nc_scmoc_{ele}_999_{yyyyMMddHH}_{aaa}
     * @param predictionTime {String} 起报时间 格式：yyyyMMddHHmmss 可以为s空
     * @param elementCode {String} 要素，多个用逗号隔开，目前支持rain,10uv,vis,t2m,tcc,vis,rh2m,wind,windp
     * @param Interval {int} 时间间隔
     * @param start {String} 开始时间yyyyMMddHHmmss
     * @param end {String} 结束时间yyyyMMddHHmmss
     * @param isReturn {String} 超过找到的起报时间是否按照起报时间最大时效（240）返回，true是返回，false是超过了就返回null
     * @param version {int} 版本
     * @param successFun
     * @param errorFun
     * @returns {*}
     */
    redis_getAnyPointsDataByLonLatAndElmentInfo: function (lngs,lats,userKeyMode,keyMode,predictionTime,elementCode,Interval,start,end,isReturn,version,successFun, errorFun) {
        var params = [];
        params = params.concat(lngs,lats,userKeyMode,keyMode,predictionTime,elementCode,Interval,start,end,isReturn);
        return this.invoke("REDIS.GetAnyPointsDataByLonLatAndElmentInfo", params, version, successFun, errorFun);
    },

    /**
     * 判断模式指定要素、时效数据是否有缺失，返回不存在要素和时效
     * @param keyMode
     * @param elements 要素名称，支持多要素例如：rain,tcc,t2m
     * @param predictionTime 起报时间20170703300000
     * @param startTimeSession 开始时效
     * @param endTimeSession 结束时效
     * @param interval 时间间隔
     * @param version 版本
     * @param successFun 返回值 json
     * @param errorFun
     * @returns {*}
     */
    redis_getKeyModeNotExistByElementInfo: function (keyMode,elements,predictionTime,startTimeSession,endTimeSession,interval,version,successFun, errorFun) {
        var params = [];
        params = params.concat(keyMode,elements,predictionTime,startTimeSession,endTimeSession,interval);
        return this.invoke("REDIS.GetKeyModeNotExistByElementInfo", params, version, successFun, errorFun);
    },

    /**
     * 判断模式的城镇、乡镇数据是否有缺失，返回不存在要素和时效
     * @param keyMode
     * @param predictionTime 起报时间20170703200000
     * @param version
     * @param successFun
     * @param errorFun
     * @returns {*}
     */
    redis_getTownKeyModeNotExistByElementInfo: function (keyMode,predictionTime,version,successFun, errorFun) {
        var params = [];
        params = params.concat(keyMode,predictionTime);
        return this.invoke("REDIS.GetTownKeyModeNotExistByElementInfo", params, version, successFun, errorFun);
    },

    /**
     * 判断模式的城镇、乡镇数据是否有缺失，返回不存在要素和时效(增加开始时效和结束时效)
     * @param keyMode
     * @param predictionTime
     * @param startTimeSession
     * @param endTimeSession
     * @param version
     * @param successFun
     * @param errorFun
     * @returns {*}
     */
    redis_getTownKeyModeNotExistByElementInfo2: function (keyMode,predictionTime,startTimeSession,endTimeSession,version,successFun, errorFun) {
        var params = [];
        params = params.concat(keyMode,predictionTime,startTimeSession,endTimeSession);
        return this.invoke("REDIS.GetTownKeyModeNotExistByElementInfo", params, version, successFun, errorFun);
    },

    /**
     * 多站点多要素
     * @param stationListKey 站点key:
     * @param keyMode b_nc_fusion_{ele}_999_2017080708_{aaa} 注：其中要素、时效保留不用替换成实际值
     * @param userKeyMode
     * @param elementNames rain12,vis12,tcc12
     * @param startTimeSession 开始时效
     * @param endTimeSession 结束时效
     * @param interval 间隔
     * @param version
     * @param successFun
     * @param errorFun
     * @returns {*}
     */
    redis_getPluralDataByStationListAndEleInfo: function (stationListKey,keyMode,userKeyMode,elementNames,startTimeSession,endTimeSession,interval,version,successFun, errorFun) {
        var params = [];
        params = params.concat(stationListKey,keyMode,userKeyMode,elementNames,startTimeSession,endTimeSession,interval);
        return this.invoke("REDIS.GetPluralDataByStationListAndEleInfo", params, version, successFun, errorFun);
    },

    /**
     * 多要素多站点保存到用户数据
     * @param stationListKey 站点key:
     * @param keyMode b_nc_fusion_{ele}_999_2017080708_{aaa} 注：其中要素、时效保留不用替换成实际值
     * @param userKeyMode
     * @param elementNames rain12,vis12,tcc12
     * @param startTimeSession 开始时效
     * @param endTimeSession 结束时效
     * @param interval 间隔
     * @param version
     * @param successFun
     * @param errorFun
     * @returns {*}
     */
    redis_setPluralDataByStationListAndElementInfo: function (DataJsonBytes,KeyMode,UserCode,PredictionTime,startTimeSession,endTimeSession,interval,version,successFun, errorFun) {
        var params = [];
        version = version||1;
        params = params.concat(DataJsonBytes,KeyMode,UserCode,PredictionTime,startTimeSession,endTimeSession,interval);
        return this.invoke("REDIS.SetPluralDataByStationListAndElementInfo", params, version, successFun, errorFun);
    },


    /**
     * 校验指定站点数据（或所有格点）的值是否矛盾，是否有无效值，（tmax24,tmin24）高低温温差是否大于校验差值，降水(rain3)与天气(wp12) 量级是否不匹配，,降水相态(pph3)与降水(rain3)是否一至，由天气现象判断降水量是否在范围内。
     * @param UserCode 暂时没有
     * @param KeyMode 模式key如：p_nc_release_{ele}_999_{yyyyMMddHH}_{aaa}
     * @param PredictionTime 起报时间 如: 20170315200000
     * @param SourceStation 站点列表：（如：o_j_town_station_list）
     * @param CityStationCode 市级站点编号（为空时为全省，不为空时只检查传入市级范围的站点）
     * @param ElementCode 要素编号,输入tmax24进入高低温检测模式.输入wp12进入天气和雨量匹配模式
     * @param TimeSessionBegin 开始时效,（如：6，数据不含开始时效）
     * @param TimeSessionEnd 结束时效,（如：60，数据包括结束时效）
     * @param TEM_difference 高低温校验差值,（如：1.5）,不是高低温检测模式输入任意值不影响天气匹配模式
     * @param version
     * @param successFun
     * @param errorFun
     * @returns {*}
     */
    redis_getStationDataIsTrue: function (UserCode,KeyMode,PredictionTime,SourceStation,CityStationCode,ElementCode,TimeSessionBegin,TimeSessionEnd,TEM_difference,version,successFun, errorFun) {
        var params = [];
        version = version||1;
        params = params.concat(UserCode,KeyMode,PredictionTime,SourceStation,CityStationCode,ElementCode,TimeSessionBegin,TimeSessionEnd,TEM_difference);
        return this.invoke("REDIS.GetStationDataIsTrue", params, version, successFun, errorFun);
    },

    redis_getREFRadarDataByKeyTimeAndLonlat: function (KeyMode,Time,MinLon,MaxLon,MinLat,MaxLat,Interval,version,successFun, errorFun) {
        var params = [];
        version = version||1;
        var lon1 = new Double(MinLon), lat1 = new Double(MinLat), lon2 = new Double(MaxLon), lat2 = new Double(MaxLat);
        var itv = new Double(Interval);
        params = params.concat(KeyMode,Time,lon1,lon2,lat1,lat2,itv);
        return this.invoke("REDIS.GetREFRadarDataByKeyTimeAndLonlat", params, version, successFun, errorFun);
    }

    //<--内存库接口
});


/**
 * 数值预报 数据代理
 * @class Sun.NwpProxy
 * @extends Sun.BaseProxy
 */
SW.Rpc.NwpProxy = SW.Rpc.BaseProxy.extend({

    options:{
        serviceUrl: '/Weather/NWP.aspx'
    },

    /**
     * 格点转站点数据
     * @method stationToGrid_getGridDataByStationInfo
     * @param dataUrl {string} 站点数据取数地址
     * @param startLon {number} 起始经度
     * @param startLat {number} 起始纬度
     * @param endLon {number} 结束经度
     * @param endLat {number} 结束纬度
     * @param nLon {number} 经度间隔
     * @param nLat {number} 纬度间隔
     * @param valueField {string} 插值字段名
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    stationToGrid_getGridDataByStationInfo: function (dataUrl, startLon, startLat, endLon, endLat, nLon, nLat, valueField, version, successFun, errorFun) {
        var params = [];
        var url = dataUrl.replace(/\|/g, '[').replace(/&/g, ']').replace(/;/g, '~');
        url = url.replace('calltype=4', 'calltype=');
        var lon1 = new Double(startLon), lat1 = new Double(startLat), lon2 = new Double(endLon), lat2 = new Double(endLat);
        var nlo = new Double(nLon), nla = new Double(nLat);
        params = params.concat(url, lon1, lat1, lon2, lat2, nlo, nla, '', '', valueField);
        return this.invoke("StationToGrid.GetGridDataByStationInfo", params, version, successFun, errorFun);
    },

    /**
     * 获取最新预报起报时间【预报】
     * @method image_getTimeListByTypeCodeAndCount
     * @param typeCode {string} 预报类型 I_FSN_GRADS_UVR24，I_FSN_GRADS_RR24，I_FSN_GRADS_TMXR24，I_FSN_GRADS_VISR24
     * @param listCount {int}
     * @param pageCount {int}
     * @param pageIndex [int]
     * @param version [int]
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    image_getTimeListByTypeCodeAndCount: function (typeCode, listCount, pageCount, pageIndex, version, successFun, errorFun) {
        var params = [];
        params = params.concat(typeCode, listCount, pageCount, pageIndex);
        return this.invoke('Image.GetTimeListByTypeCodeAndCount', params, version, successFun, errorFun);
    },

    /**
     * 获取最新起报时间【图片版】
     * @method nwp_ImageGetLatestPredictionTimeByTypeCode
     * @param typeCode {string} 图片code
     * @param [version] [int] 不传时默认为-1
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    image_GetLatestPredictionTimeByTypeCode: function (typeCode, version, successFun, errorFun) {
        var params = [];
        params = params.concat(typeCode);
        return this.invoke("Image.GetLatestPredictionTimeByTypeCode", params, version, successFun, errorFun);
    },
    /**
     * 获取最新起报时效【图片版】
     * @method nwp_ImageGetDataListByTypeCodeAndPreTime
     * @param typeCode {string} 图片code
     * @param predictionTime {Date} 起报时间
     * @param hour {int} 间隔时间 默认为-1
     * @param [version] [int] 不传时默认为-1
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    image_getDataListByTypeCodeAndPreTime: function (typeCode, predictionTime, hour, version, successFun, errorFun) {
        var params = [];
        params = params.concat(typeCode, predictionTime, hour);
        return this.invoke("Image.GetDataListByTypeCodeAndPreTime", params, version, successFun, errorFun);
    },
    /**
     * 获取最新起报时间【文件版】
     * @method nwp_StreamGetTimeListByTypeCodeAndCount
     * @param typeCode {string} 文件版code
     * @param listCount {int} -1
     * @param pageCount {int} -1
     * @param pageIndex {int} -1
     * @param [version] [int] 不传时默认为1
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    stream_getTimeListByTypeCodeAndCount: function (typeCode, listCount, pageCount, pageIndex, version, successFun, errorFun) {
        var params = [];
        params = params.concat(typeCode, listCount, pageCount, pageIndex);
        return this.invoke("Stream.GetTimeListByTypeCodeAndCount", params, version, successFun, errorFun);
    },

    /**
     * 通过起报时间获取数值预报列表
     * @method stream_getDataListByTypeCodeAndPreTimeAndHour
     * @param typeCode {string} typecode
     * @param predictionTime {Date} 起报时间
     * @param hour {int} 间隔时间 默认为-1
     * @param pageCount {int} -1
     * @param pageIndex {int} -1
     * @param [version] [int] 不传时默认为1  (1:返回流文件 2&3:返回json文件 2:支持单个typecode 3:支持多个typecode)
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    stream_getDataListByTypeCodeAndPreTimeAndHour: function (typeCode, predictionTime, hour, pageCount, pageIndex, version, successFun, errorFun) {
        var params = [];
        params = params.concat(typeCode, predictionTime, hour, pageCount, pageIndex);
        return this.invoke("Stream.GetDataListByTypeCodeAndPreTimeAndHour", params, version, successFun, errorFun);
    },

    /**
     * 获取潜力分析数据
     * @param typeCode
     * @param vilElement
     * @param niElement
     * @param predictionTime
     * @param timeSessions
     * @param level
     * @param vilValue
     * @param niValue
     * @param successFun
     * @param version
     * @param errorFun
     */
    stream_getPotentialAnalysisDataByTypeCodeAndPredictiontime : function (typeCode,vilElement,niElement,predictionTime,timeSessions,level,vilValue,niValue,version, successFun, errorFun) {
        var params = [];
        var vil = new Double(vilValue);
        var ni = new Double(niValue);
        params = params.concat(typeCode,vilElement,niElement,predictionTime,parseInt(timeSessions),parseInt(level),vil,ni);
        return this.invoke("Stream.GetPotentialAnalysisDataByTypeCodeAndPredictiontime", params, version, successFun, errorFun);
    },
    stream_getLatestDataListByTypeCodeAndTimeRange: function(typeCode, sTime, eTime, version, successFun, errorFun){
        var params = [];
        params = params.concat(typeCode, sTime, eTime);
        return this.invoke("Stream.GetLatestDataListByTypeCodeAndTimeRange", params,version, successFun, errorFun);
    },
    stream_getJXHStreamDataListByTypeCodeAndLocationAndHourAndQueryTime : function (typeCode,sixType,predictionTime,interval,lon,lat,version, successFun, errorFun) {
        var params = [];
        lon = new Double(lon);
        lat = new Double(lat);
        params = params.concat(typeCode,sixType,predictionTime,interval,lon,lat);
        return this.invoke("Stream.GetJXHStreamDataListByTypeCodeAndLocationAndHourAndQueryTime", params,version, successFun, errorFun);
    },


    /**
     * 获取数值预报空间剖面
     * @param nwpMode
     * @param predictionTime
     * @param TimeSession
     * @param LatLon1
     * @param LatLon2
     * @param GridElement
     * @param FillElement
     * @param StrokeElement
     * @param successFun
     * @param version
     * @param errorFun
     */
    profile_getSpaceProfileDataOfTimeSession : function (nwpMode,predictionTime,TimeSession,LatLon1,LatLon2,GridElement,FillElement,StrokeElement,version, successFun, errorFun) {
        var params = [];
        params = params.concat(nwpMode,predictionTime,parseInt(TimeSession),LatLon1,LatLon2,GridElement,FillElement,StrokeElement);
        return this.invoke("Profile.GetSpaceProfileDataOfTimeSession", params, version, successFun, errorFun);
    },

    //----------------------
    // 数值预报合成数据
    //----------------------

    // 获取最新起报时间【合成数据版】
    complex_getTimeListByTypeCodeAndCount: function (typeCode, listCount, pageCount, pageIndex, version, successFun, errorFun) {
        var params = [];
        params = params.concat(typeCode, listCount, pageCount, pageIndex);
        return this.invoke("Complex.GetTimeListByTypeCodeAndCount", params, version, successFun, errorFun);
    },

    //根据产品类型、起报时间、时间段范围、经纬度范围获取累计网格数据
    complex_getDataValueSumByTypeCodeAndPreTimeAndTimeRange : function (typeCode,predictionTime,beginTime,endTime,startLon,startLat,endLon,endLat,version, successFun, errorFun) {
        var params = [];
        params = params.concat(typeCode,predictionTime,beginTime,endTime,startLon,startLat,endLon,endLat);
        return this.invoke("Complex.GetDataValueSumByTypeCodeAndPreTimeAndTimeRange", params, version, successFun, errorFun);
    },

    // 根据产品类型、时间段范围、经纬度范围获取累计网格数据
    complex_getDataValueSumByTypeCodeAndTimeRange : function (typeCode,beginTime,endTime,startLon,startLat,endLon,endLat,version, successFun, errorFun) {
        var params = [];
        params = params.concat(typeCode,beginTime,endTime,startLon,startLat,endLon,endLat);
        return this.invoke("Complex.GetDataValueSumByTypeCodeAndTimeRange", params, version, successFun, errorFun);
    },

    // 根据产品类型、时间段范围、经纬度范围获取最大网格数据
    complex_getDataValueMaxByTypeCodeAndTimeRange : function (typeCode,beginTime,endTime,startLon,startLat,endLon,endLat,version, successFun, errorFun) {
        var params = [];
        params = params.concat(typeCode,beginTime,endTime,startLon,startLat,endLon,endLat);
        return this.invoke("Complex.GetDataValueMaxByTypeCodeAndTimeRange", params, version, successFun, errorFun);
    },

    // 根据产品类型、时间段范围、经纬度范围获取最小网格数据
    complex_getDataValueMinByTypeCodeAndTimeRange : function (typeCode,beginTime,endTime,startLon,startLat,endLon,endLat,version, successFun, errorFun) {
        var params = [];
        params = params.concat(typeCode,beginTime,endTime,startLon,startLat,endLon,endLat);
        return this.invoke("Complex.GetDataValueMinByTypeCodeAndTimeRange", params, version, successFun, errorFun);
    },


    /*
     * 获取预报数据
     * @Param forecasIds
     * @Param timeSession
     * @Param preTime
     * @Param typeCode
     * @param collectionCode
     * */
    complex_getNearZdzAndNwpListByCollectionCode : function (forecasIds,timeSession,preTime,typeCode,collectionCode,version,successFun, errorFun) {
        var params = [];
        params = params.concat(forecasIds,timeSession,preTime,typeCode,collectionCode);
        return this.invoke("Complex.GetNearZdzAndNwpListByCollectionCode", params, version,successFun, errorFun);
    },

    nwp_getProfileDataByTypeCode: function(typeCode,predictionTime,LatLon1,LatLon2,version, successFun, errorFun){
        var params = [];
        params = params.concat(typeCode,predictionTime,LatLon1,LatLon2);
        return this.invoke("Profile.GetProfileDataByTypeCode", params, version,successFun, errorFun);
    },

    /**
     * 获取T_lnP图绘制数据
     */
    physical_getDataByPlace: function (date,timeSession,lon,lat,version, successFun, errorFun) {
        var params = [];
        params = params.concat(date,timeSession,lon,lat);
        return this.invoke("Physical.GetDataByPlace", params, version, successFun, errorFun);
    }

});

/**
 * 雷达 数据代理
 * @class Sun.RadarProxy
 * @extends Sun.BaseProxy
 */
SW.Rpc.RadarProxy = SW.Rpc.BaseProxy.extend({
    options:{
        serviceUrl: '/Weather/RAD.aspx'
    },



    /**
     * 根据雷达Code获取雷达列表
     * @method rad_getDataListByTypeCode
     * @param typeCode {string} 雷达code
     * @param listCount {int} 获取条数
     * @param pageCount {int} -1
     * @param pageIndex {int} -1
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    rad_getDataListByTypeCode: function (typeCode, listCount, pageCount, pageIndex, version, successFun, errorFun) {
        var params = [];
        params = params.concat(typeCode, listCount, pageCount, pageIndex);
        return this.invoke("RAD.GetDataListByTypeCode", params, version, successFun, errorFun);
    },
    /**
     * 根据雷达Code和仰角获取雷达列表
     * @method rad_getDataListByTypeCodeAndEA
     * @param typeCode {string} 雷达code
     * @param elevationAngle {number} 雷达仰角
     * @param listCount {int} 获取条数
     * @param pageCount {int} -1
     * @param pageIndex {int} -1
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     */
    rad_getDataListByTypeCodeAndEA: function (typeCode, elevationAngle, listCount, pageCount, pageIndex, version, successFun, errorFun) {
        var params = [];
        var e = new Double(elevationAngle);
        params = params.concat(typeCode, e, listCount, pageCount, pageIndex);
        return this.invoke("RAD.GetDataListByTypeCodeAndEA", params, version, successFun, errorFun);
    },

    /**
     * 根据雷达Code和仰角获取指定时间段内的雷达列表
     * @method rad_getDataListByTypeCodeAndTimesAndEA
     * @param typeCode {string} 雷达code
     * @param elevationAngle {number} 雷达仰角
     * @param beginTime {Date} 查询开始时间
     * @param endTime {Date} 查询结束时间
     * @param pageCount {int} -1
     * @param pageIndex {int} -1
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     */
    rad_getDataListByTypeCodeAndTimesAndEA: function (typeCode, elevationAngle, beginTime, endTime, pageCount, pageIndex, version, successFun, errorFun) {
        var params = [];
        var e = new Double(elevationAngle);
        params = params.concat(typeCode, e, beginTime, endTime, pageCount, pageIndex);
        return this.invoke("RAD.GetDataListByTypeCodeAndTimesAndEA", params, version, successFun, errorFun);
    },

    /**
     * 获取雷达剖面数据
     *
     * 数据的间隔及高度固定为0.5和20，与展示相匹配
     * @method rad_getProfileDataByTypeCodeAndQueryTime
     * @param typeCode {string} 雷达剖面typecode
     * @param ProductTime {Date} 雷达图产品时间
     * @param centerP {L.Latlng} 雷达图中心经纬
     * @param latlon1 {L.Latlng} 剖面开始经纬
     * @param latlon2 {L.Latlng} 剖面结束经纬
     * @param yinterval {number} y坐标轴间隔，推荐0.5
     * @param height {number} 雷达剖面总高度，推荐20
     * @param version {int} 接口版本
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     */
    rad_getProfileDataByTypeCodeAndQueryTime: function (typeCode, ProductTime, centerP,  latlon1, latlon2, yinterval,height,version, successFun, errorFun) {
        // 剖面起止经纬点转在雷达上的位置
        // var x1s = leftTop.lng < latlon1.lng ? 1 : -1;
        // var y1s = leftTop.lat > latlon1.lat ? 1 : -1;
        // var x2s = leftTop.lng < latlon2.lng ? 1 : -1;
        // var y2s = leftTop.lat > latlon2.lat ? 1 : -1;
        // var x1 = latlon1.distanceTo(L.latLng([latlon1.lat, leftTop.lng])) / 1000 * x1s;
        // var y1 = latlon1.distanceTo(L.latLng([leftTop.lat, latlon1.lng])) / 1000 * y1s;
        // var x2 = latlon2.distanceTo(L.latLng([latlon2.lat, leftTop.lng])) / 1000 * x2s;
        // var y2 = latlon2.distanceTo(L.latLng([leftTop.lat, latlon2.lng])) / 1000 * y2s;

        var params = [];
        params = params.concat(typeCode, ProductTime, centerP.lat + ',' + centerP.lng, latlon1.lat + ',' + latlon1.lng,
            latlon2.lat + ',' + latlon2.lng, new Double(yinterval), new Double(height));
        return this.invoke("RAD.GetProfileDataByTypeCodeAndQueryTime", params, version, successFun, errorFun);
    },
    /**
     * 根据雷达Code和高度获取雷达列表
     * @method rad_getDataListByTypeCodeAndEA
     * @param typeCode {string} 雷达code
     * @param layer {number} 雷达高度
     * @param listCount {int} 获取条数
     * @param pageCount {int} -1
     * @param pageIndex {int} -1
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     */
    rad_getPUPDataFromFileByQueryTime: function (queryTime, maxHour, version,successFun, errorFun) {
        var params = [];
        params = params.concat(queryTime,maxHour);
        return this.invoke("RAD.GetPUPDataFromFileByQueryTime", params,version, successFun, errorFun);
    },
    /**
     * 根据雷达Code和高度获取雷达列表
     * @method rad_getDataListByTypeCodeAndEA
     * @param typeCode {string} 雷达code
     * @param layer {number} 雷达高度
     * @param listCount {int} 获取条数
     * @param pageCount {int} -1
     * @param pageIndex {int} -1
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     */
    rad_getDataListByTypeCodeAndLayer: function (typeCode, layer, listCount, pageCount, pageIndex,version, successFun, errorFun) {
        var params = [];
        var e = new Double(layer);
        params = params.concat(typeCode, e, listCount, pageCount, pageIndex);
        return  this.invoke("RAD.GetDataListByTypeCodeAndLayer", params, version,successFun, errorFun);
    },
    /**
     * 根据雷达Code和高度获取雷达列表
     * @method rad_getDataListByTypeCodeAndEA
     * @param typeCode {string} 雷达code
     * @param layer {number} 雷达高度
     * @param listCount {int} 获取条数
     * @param pageCount {int} -1
     * @param pageIndex {int} -1
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     */
    rad_getDataListByTypeCodeAndTimesAndLayer: function (typeCode, layer, beginTime, endTime, pageCount, pageIndex, version,successFun, errorFun) {
        var params = [];
        var e = new Double(layer);
        params = params.concat(typeCode, e, beginTime, endTime, pageCount, pageIndex);
        return this.invoke("RAD.GetDataListByTypeCodeAndTimesAndLayer", params, version,successFun, errorFun);
    },
    rad_getDataListByTypeCodeAndTimes: function (typeCode, beginTime, endTime, pageCount, pageIndex,version, successFun, errorFun) {
        var params = [];
        params = params.concat(typeCode, beginTime, endTime, pageCount, pageIndex);
        return this.invoke("RAD.GetDataListByTypeCodeAndTimes", params,version, successFun, errorFun);
    },
    /**
     * 返回指定雷达dbz的面积
     * @param typeCode
     * @param productTime
     * @param area
     * @param dbz
     * @param version
     * @param successFun
     * @param errorFun
     * @return {*}
     */
    rad_checkRadByTypeCodeAndAreaDbz: function (typeCode, productTime, area, dbz, version,successFun, errorFun) {
        var params = [];
        params = params.concat(typeCode, productTime, area, dbz);
        return this.invoke("RAD.CheckRadByTypeCodeAndAreaDbz", params, version,successFun, errorFun);
    }


});


/**
 * 云图 数据代理
 * @class Sun.SatProxy
 * @extends Sun.BaseProxy
 */
SW.Rpc.SatProxy = SW.Rpc.BaseProxy.extend({
    options:{
        serviceUrl: '/Weather/SAT.aspx'
    },


    /**
     * 根据云图Code获取时间段内的云图列表
     * @method sat_getDataListByTypeCodeAndTimes
     * @param typeCode {string} 云图code
     * @param beginTime {Date} 查询开始时间
     * @param endTime {Date} 查询结束时间
     * @param pageCount {int} -1
     * @param pageIndex {int} -1
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    sat_getDataListByTypeCodeAndTimes: function (typeCode, beginTime, endTime, pageCount, pageIndex, version, successFun, errorFun) {
        var params = [];
        params = params.concat(typeCode, beginTime, endTime, pageCount, pageIndex);
        return this.invoke("SAT.GetDataListByTypeCodeAndTimes", params, version, successFun, errorFun);
    },
    /**
     * 获取n条最新云图
     * @method sat_getDataListByTypeCode
     * @param typeCode
     * @param listCount
     * @param pageCount
     * @param pageIndex
     * @param successFun
     * @param errorFun
     */
    sat_getDataListByTypeCode: function (typeCode,listCount,pageCount,pageIndex,version, successFun, errorFun) {
        var params = [];
        params = params.concat(typeCode,listCount,pageCount,pageIndex);
        return this.invoke("SAT.GetDataListByTypeCode", params, version, successFun, errorFun);
    }
});
/**
 * 主观预报类 数据代理
 * @class Sun.SwpProxy
 * @extends Sun.BaseProxy
 */
SW.Rpc.SwpProxy = SW.Rpc.BaseProxy.extend({

    options:{
        serviceUrl: '/Weather/SWP.aspx'
    },


    /**
     * 根据站点获取逐六小时预报
     * @method fine24_getDataByStationCodes
     * @param stationCodes {string} 站号，如：'58847'/'58847,58846'
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    fine24_getDataByStationCodes: function (stationCodes, version, successFun, errorFun) {
        var params = [];
        params = params.concat(stationCodes);
        return this.invoke("FINE_24.GetDataByStationCodes", params, version, successFun, errorFun);
    },

    /**
     * 根据站点获取逐六小时预报列表
     * @method fine24_getDataListByStationCode
     * @param stationCodes {string} 站号，如：'58847'/'58847,58846'
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    fine24_getDataListByStationCode: function (stationCodes, version, successFun, errorFun) {
        var params = [];
        params = params.concat(stationCodes);
        return this.invoke("FINE_24.GetDataListByStationCode", params, version, successFun, errorFun);
    },

    /**
     * 获取组合站逐六小时预报
     * @method fine24_getDataByCollectionCode
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    fine24_getDataByCollectionCode: function (collectionCode, version, successFun, errorFun) {
        var params = [];
        params = params.concat(collectionCode);
        return this.invoke("FINE_24.GetDataByCollectionCode", params, version, successFun, errorFun);
    },

    /**
     * 获取站点168小时精细化（7天）预报
     * @method fine168_getDataByStationCodes
     * @param stationCodes {string} 站号，如：'58847'/'58847,58846'
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    fine168_getDataByStationCodes: function (stationCodes, version, successFun, errorFun) {
        var params = [];
        params = params.concat(stationCodes);
        return this.invoke("FINE_168.GetDataByStationCodes", params, version, successFun, errorFun);
    },

    /**
     * 获取组合站1168小时精细化（7天）预报
     * @method fine168_getDataByCollectionCode
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    fine168_getDataByCollectionCode: function (collectionCode, version, successFun, errorFun) {
        var params = [];
        params = params.concat(collectionCode);
        return this.invoke("FINE_168.GetDataByCollectionCode", params, version, successFun, errorFun);
    },

    //----------------------------------
    //  ALMT
    //----------------------------------

    /**
     * 获取组合站预警信号列表
     * @method almt_getHistoryListByCollectionCode
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param listCount {int} 获取条数
     * @param pageCount {int} -1
     * @param pageIndex {int} -1
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    almt_getHistoryListByCollectionCode: function (collectionCode, listCount, pageCount, pageIndex, version, successFun, errorFun) {
        var params = [];
        params = params.concat(collectionCode, listCount, pageCount, pageIndex);
        return this.invoke('ALMT.GetHistoryListByCollectionCode', params, version, successFun, errorFun);
    },
    /**
     * 获取组合站24小时预警信号
     * @method almt_getDataByCollectionCode
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    almt_getDataByCollectionCode: function (collectionCode, version, successFun, errorFun) {
        var params = [];
        params = params.concat(collectionCode);
        return this.invoke('ALMT.GetDataByCollectionCode', params, version, successFun, errorFun);
    },
    /**
     * 获取站点的预警信号
     * @method almt_getDataByStationCodes
     * @param StationCode {string} 组合站code，如：'58000'
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    almt_getDataByStationCodes: function (stationCode, version,successFun, errorFun) {
        var params = [];
        params = params.concat(stationCode);
        return this.invoke('ALMT.GetDataByStationCodes', params,version, successFun, errorFun);
    },
    /**
     * 获取组合站近n分钟预警信号
     * @method almt_getDataByCollectionCode
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    almt_getDataByCollectionAndMinuteAndQueryTime: function (collectionCode,minute,qureyTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(collectionCode,minute,qureyTime);
        return this.invoke('ALMT.GetDataByCollectionAndMinuteAndQueryTime', params, version, successFun, errorFun);
    },
    /**
     * 获取n小时危险天气
     * @param collectionCode
     * @param hours
     * @param queryTime
     * @param successFun
     * @param errorFun
     * @returns {*}
     */
    ws_getDataByCollectionCodeAndHoursAndQueryTime: function (collectionCode,hours,queryTime,version,successFun, errorFun) {
        var params = [];
        params = params.concat(collectionCode,hours,queryTime);
        return this.invoke('WS.GetDataByCollectionCodeAndHoursAndQueryTime', params,version, successFun, errorFun);
    },


    /**
     * 获取预报信息
     * @method txt_getDataByTypeCode
     * @param typeCode {string}
     * @param isContent {boolean}
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    txt_getDataByTypeCode: function(typeCode,isContent,successFun,errorFun){
        var params = [];
        params = params.concat(typeCode,isContent);
        return this.invoke('Text.GetDataByTypeCode', params, version, successFun, errorFun);
    }
});



/**
 * 自动站 数据代理
 * @class ZdzProxy
 * @extends Sun.BaseProxy
 */
SW.Rpc.ZdzProxy = SW.Rpc.BaseProxy.extend({

    options:{
        serviceUrl: '/Weather/ZDZ.aspx'
    },

    /**
     * 获得单站/多站自由Key的自动站数据
     * @method zdz_getDataByStationCodeAndWeatherKeys
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param stationCode {string} 站号，如：'58847'/'58847,58846'
     * @param weatherKeys {string} 要素key值，如：'rain_sum_1h'
     * @param queryTime {Date} 查询时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getDataByStationCodeAndWeatherKeys: function (dataRate, stationCode, weatherKeys, queryTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, stationCode, weatherKeys, queryTime);
        return this.invoke('ZDZ.GetDataByStationCodesAndWeatherKeys', params, version, successFun, errorFun);
    },

    /**
     * 获得组合站自由Key的自动站数据
     * @method zdz_getDataByCollectionCodeAndWeatherKeys
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param weatherKeys {string} 要素key值，如：'rain_sum_1h'
     * @param queryTime {Date} 查询时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getDataByCollectionCodeAndWeatherKeys: function (dataRate, collectionCode, weatherKeys, queryTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, weatherKeys, queryTime);
        return this.invoke('ZDZ.GetDataByCollectionCodeAndWeatherKeys', params, version, successFun, errorFun);
    },

    /**
     * 多要素接口
     * @param dataRate
     * @param collectionCode
     * @param weatherKeys
     * @param beginTime
     * @param endTime
     * @param successFun
     * @param errorFun
     * @return {*}
     */
    zdz_getDataByCollectionCodeAndWeatherKeysAndTimeRanges: function (dataRate, collectionCode, weatherKeys, beginTime, endTime,version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, weatherKeys, beginTime, endTime);
        return this.invoke('ZDZ.GetDataByCollectionCodeAndWeatherKeysAndTimeRanges', params,version, successFun, errorFun);
    },

    /**
     * 根据站点编号、WeatherKeys和时间间隔获取列表
     * @param dataRate
     * @param stationCodes
     * @param weatherKeys
     * @param beginTime
     * @param endTime
     * @param successFun
     * @param errorFun
     * @returns {*}
     */
    zdz_getDataListByStationCodesAndWeatherKeysAndTimeRanges: function(dataRate,stationCodes,weatherKeys,beginTime,endTime,version,successFun, errorFun){
        var params = [];
        params = params.concat(dataRate,stationCodes,weatherKeys,beginTime,endTime);
        return this.invoke('ZDZ.GetDataListByStationCodesAndWeatherKeysAndTimeRanges', params, version,successFun, errorFun);
    },

    //----------------------------------
    //  自动站  降水 Rain
    //----------------------------------
    /**
     * 获得单站/多站的自由时间段降水
     * @method zdz_getRainSumByStationCodesAndTimeRange
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param stationCodes {string} 站号，如：'58847'/'58847,58846'
     * @param beginTime {Date} 查询开始时间
     * @param endTime {Date} 查询结束时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getRainSumByStationCodesAndTimeRange: function (dataRate, stationCodes, beginTime, endTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, stationCodes, beginTime, endTime);
        return this.invoke('ZDZ.GetRainSumByStationCodesAndTimeRange', params, version, successFun, errorFun);
    },

    /**
     * 获得组合站的自由时间段降水
     * @method zdz_getRainSumByCollectionCodeAndTimeRange
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param beginTime {Date} 查询开始时间
     * @param endTime {Date} 查询结束时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getRainSumByCollectionCodeAndTimeRange: function (dataRate, collectionCode, beginTime, endTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, beginTime, endTime);
        return this.invoke('ZDZ.GetRainSumByCollectionCodeAndTimeRange', params, version, successFun, errorFun);
    },

    /**
     * 获取组合站预计算降水  只可访问整点的数据，顾也无DateRate参数
     * @method zdz_getPreCalcRainSumByCollectionCodeAndTimeRange
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param beginTime {Date} 查询开始时间
     * @param endTime {Date} 查询结束时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getPreCalcRainSumByCollectionCodeAndTimeRange: function (collectionCode, beginTime, endTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(collectionCode, beginTime, endTime);
        return this.invoke('ZDZ.GetPreCalcRainSumByCollectionCodeAndTimeRange', params, version, successFun, errorFun);
    },
    /**
     * 通过分钟数获得指定站点的降水列表
     * @method zdz_getRainListByStationCodesAndMinutesAndQueryTime
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param stationCodes {string} 站号，如：'58847'/'58847,58846'
     * @param minutes {number} 分钟数
     * @param queryTime {Date} 查询时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getRainListByStationCodesAndMinutesAndQueryTime: function (dataRate, stationCodes, minutes, queryTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, stationCodes, minutes, queryTime);
        return this.invoke('ZDZ.GetRainListByStationCodesAndMinutesAndQueryTime', params, version, successFun, errorFun, false);
    },

    /**
     * 通过起止时间获得指定站点的降水列表
     * @method zdz_getRainListByStationCodesAndTimeRange
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param stationCodes {string} 站号，如：'58847'/'58847,58846'
     * @param beginTime {Date} 查询开始时间
     * @param endTime {Date} 查询结束时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getRainListByStationCodesAndTimeRange: function (dataRate, stationCodes, beginTime, endTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, stationCodes, beginTime, endTime);
        return this.invoke('ZDZ.GetRainListByStationCodesAndTimeRange', params, version, successFun, errorFun, false);
    },

    /**
     * 获得水利组合站的自由时间段降水
     * @method slZdz_getRainSumByCollectionCodeAndTimeRange
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param beginTime {Date} 查询开始时间
     * @param endTime {Date} 查询结束时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    slZdz_getRainSumByCollectionCodeAndTimeRange: function (dataRate, collectionCode, beginTime, endTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, beginTime, endTime);
        return this.invoke('SLZDZ.GetRainSumByCollectionCodeAndTimeRange', params, version, successFun, errorFun);
    },

    /**
     * 获得水利组合站的实时降水
     * @method slZdz_getRainCurrentByCollectionCodeAndQueryTime
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param queryTime {Date} 查询时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    slZdz_getRainCurrentByCollectionCodeAndQueryTime: function (dataRate, collectionCode, queryTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, queryTime);
        return this.invoke('SLZDZ.GetRainCurrentByCollectionCodeAndQueryTime', params, version, successFun, errorFun);
    },

    /**
     * 获得水利指定站的时间段降水列表
     * @method slZdz_getRainListByStationCodesAndTimeRange
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param stationCodes {string} 站号，如：'58847'/'58847,58846'
     * @param beginTime {Date} 查询开始时间
     * @param endTime {Date} 查询结束时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    slZdz_getRainListByStationCodesAndTimeRange: function (dataRate, stationCodes, beginTime, endTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, stationCodes, beginTime, endTime);
        return this.invoke('SLZDZ.GetRainListByStationCodesAndTimeRange', params, version, successFun, errorFun, false);
    },

    /**
     * 过程降水查询
     * @param dataRate 数据频率 tenminute：10分钟;onehour：1小时;oneday_0_24：1日（0-24）;oneday_8_8：1日（8-8）;oneday_20_20:1日（20-20）
     * @param collectionCode 组合站编码
     * @param beginTime 查询开始时间
     * @param endTime 查询结束时间
     * @param successFun 查询成功回调
     * @param errorFun 查询失败回调
     * @returns {*}
     */
    zdz_getRainSumAndDetailByCollectionCodeAndTimeRange: function (dataRate, collectionCode, beginTime, endTime, version,successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, beginTime, endTime);
        return this.invoke('ZDZ.GetRainSumAndDetailByCollectionCodeAndTimeRange', params,version, successFun, errorFun);
    },
    /**
     * 获得组合站的自由时间段降水
     * @method zdz_getRainSumByCollectionCodeAndTimeRange
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param minutes
     * @param queryTime
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getRainSumByCollectionCodeAndMinutesAndQueryTime: function (dataRate, collectionCode, minutes, queryTime,version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, minutes, queryTime);
        return this.invoke('ZDZ.GetRainSumByCollectionCodeAndMinutesAndQueryTime', params, version,successFun, errorFun);
    },

    //----------------------------------
    //  自动站  站点编号获取实时数据
    //----------------------------------
    /**
     * 根据站点编号查询时间获取查询时间点的气温
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param stationCodes {string} 站点编号
     * @param queryTime {Date} 查询时间
     * @param successFun {function} 查询成功回调
     * @param errorFun {function} 查询失败回调
     * @returns {*}
     */
    zdz_getAirtempCurrentByStationCodesAndQueryTime: function (dataRate,stationCodes,queryTime,version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate,stationCodes,queryTime);
        return this.invoke('ZDZ.GetAirtempCurrentByStationCodesAndQueryTime', params, version, successFun, errorFun);
    },


    /**
     * 根据站点编号查询时间获取查询时间点的风向风速
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param stationCodes {string} 站点编号
     * @param queryTime {Date} 查询时间
     * @param successFun {function} 查询成功回调
     * @param errorFun {function} 查询失败回调
     * @returns {*}
     */
    zdz_getWindCurrentByStationCodesAndQueryTime: function (dataRate,stationCodes,queryTime,version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate,stationCodes,queryTime);
        return this.invoke('ZDZ.GetWindCurrentByStationCodesAndQueryTime', params, version, successFun, errorFun);
    },

    /**
     * 根据组合站点编号和时间段获取本时次的极大风向风速
     * @method zdz_getWindMaxByCollectionCodeAndTimeRange
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param queryTime {Date} 查询时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getWindExCurHourByCollectionCodeAndQueryTime: function (dataRate, collectionCode, queryTime,version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, queryTime);
        return this.invoke('ZDZ.GetWindExCurHourByCollectionCodeAndQueryTime', params, version,successFun, errorFun);
    },
    /**
     * 根据组合站点编号和时间段获取本时次的最大风向风速
     * @method zdz_getWindMaxByCollectionCodeAndTimeRange
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param queryTime {Date} 查询时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getWindMaxCurHourByCollectionCodeAndQueryTime: function (dataRate, collectionCode, queryTime,version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, queryTime);
        return this.invoke('ZDZ.GetWindMaxCurHourByCollectionCodeAndQueryTime', params, successFun,version, errorFun);
    },

    /**
     * 根据站点编号查询时间获取查询时间点的相对湿度
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param stationCodes {string} 站点编号
     * @param queryTime {Date} 查询时间
     * @param successFun {function} 查询成功回调
     * @param errorFun {function} 查询失败回调
     * @returns {*}
     */
    zdz_getRHCurrentByStationCodesAndQueryTime: function (dataRate,stationCodes,queryTime,version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate,stationCodes,queryTime);
        return this.invoke('ZDZ.GetRHCurrentByStationCodesAndQueryTime', params, version, successFun, errorFun);
    },

    /**
     * 根据站点编号查询时间获取查询时间点的能见度
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param stationCodes {string} 站点编号
     * @param queryTime {Date} 查询时间
     * @param successFun {function} 查询成功回调
     * @param errorFun {function} 查询失败回调
     * @returns {*}
     */
    zdz_getVisibilityCurrentByStationCodesAndQueryTime: function (dataRate,stationCodes,queryTime,version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate,stationCodes,queryTime);
        return this.invoke('ZDZ.GetVisibilityCurrentByStationCodesAndQueryTime', params, version, successFun, errorFun);
    },

    zdz_getVisibilityOneMinuteByCollectionCodeAndQueryTimeRange: function (dataRate, collectionCode, beginTime, endTime,version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, beginTime, endTime);
        return this.invoke('ZDZ.GetVisibilityMinOneMinuteByCollectionCodeAndTimeRange', params,version, successFun, errorFun);
    },
    zdz_getVisibilityOneMinuteByCollectionCodeAndQueryTime: function (dataRate, collectionCode, queryTime,version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, queryTime);
        return this.invoke('ZDZ.GetVisibilityOneMinuteByCollectionCodeAndQueryTime', params,version, successFun, errorFun);
    },

    /**
     * 根据站点编号-开始时间-结束时间获取时间段内海平面气压，beginTime 与 endTime 相同时为实时数据
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param stationCodes {string} 站点编号
     * @param beginTime  {Date} 开始时间
     * @param endTime {Date} 结束时间
     * @param successFun {function} 查询成功回调
     * @param errorFun {function} 查询失败回调
     * @returns {*}
     */
    zdz_getSeaPressureListByStationCodesAndTimeRange: function (dataRate,stationCodes,beginTime,endTime,version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate,stationCodes,beginTime,endTime);
        return this.invoke('ZDZ.GetSeaPressureListByStationCodesAndTimeRange', params, version, successFun, errorFun);
    },

    /**
     * 根据站点编号-分钟-查询时间获取该查询时间前的minutes 分钟的降水
     * @param dataRate  {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param stationCodes  {string} 站点编号
     * @param minutes {int} 分钟 如：60
     * @param queryTime {Date} 查询时间
     * @param successFun {function} 查询成功回调
     * @param errorFun {function} 查询失败回调
     * @returns {*}
     */
    zdz_getRainSumByStationCodesAndMinutesAndQueryTime: function (dataRate,stationCodes,minutes,queryTime,version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate,stationCodes,minutes,queryTime);
        return this.invoke('ZDZ.GetRainSumByStationCodesAndMinutesAndQueryTime', params, version, successFun, errorFun);
    } ,

    //----------------------------------
    //  自动站  水位 Water Level
    //----------------------------------

    /**
     * 获得水利组合站的实时水位
     * @method slZdz_getWaterLevelCurrentByCollectionCodeAndQueryTime
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param queryTime {Date} 查询时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    slZdz_getWaterLevelCurrentByCollectionCodeAndQueryTime: function (dataRate, collectionCode, queryTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, queryTime);
        return this.invoke('SLZDZ.GetWaterLevelCurrentByCollectionCodeAndQueryTime', params, version, successFun, errorFun);
    },

    /**
     * 获得水利指定站的时间段水位列表
     * @method slZdz_getWaterLevelListByStationCodesAndTimeRange
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param stationCodes {string} 站号，如：'58847'/'58847,58846'
     * @param beginTime {Date} 查询开始时间
     * @param endTime {Date} 查询结束时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    slZdz_getWaterLevelListByStationCodesAndTimeRange: function (dataRate, stationCodes, beginTime, endTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, stationCodes, beginTime, endTime);
        return this.invoke('SLZDZ.GetWaterLevelListByStationCodesAndTimeRange', params, version, successFun, errorFun, false);
    },
    //----------------------------------
    //  自动站  风  Wind
    //----------------------------------
    /**
     * 获取组合站的瞬时风
     * @method zdz_getWindCurrentByCollectionCodeAndQueryTime
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param queryTime {Date} 查询时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getWindCurrentByCollectionCodeAndQueryTime: function (dataRate, collectionCode, queryTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, queryTime);
        return this.invoke('ZDZ.GetWindCurrentByCollectionCodeAndQueryTime', params, version, successFun, errorFun);
    },

    /**
     * 根据组合站点编号和时间段获取指定时间内的最大风向风速
     * @method zdz_getWindMaxByCollectionCodeAndTimeRange
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param beginTime {Date} 查询开始时间
     * @param endTime {Date} 查询结束时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getWindMaxByCollectionCodeAndTimeRange: function (dataRate, collectionCode, beginTime, endTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, beginTime, endTime);
        return this.invoke('ZDZ.GetWindMaxByCollectionCodeAndTimeRange', params, version, successFun, errorFun);
    },

    /**
     * 根据组合站点编号和时间段获取指定时间内的极大风向风速
     * @method zdz_getWindExMaxByCollectionCodeAndTimeRange
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param beginTime {Date} 查询开始时间
     * @param endTime {Date} 查询结束时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getWindExMaxByCollectionCodeAndTimeRange: function (dataRate, collectionCode, beginTime, endTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, beginTime, endTime);
        return this.invoke('ZDZ.GetWindExMaxByCollectionCodeAndTimeRange', params, version, successFun, errorFun);
    },

    /**
     * 根据组合站点编号和时间段获取指定时间内的10分钟风列表
     * @method zdz_getWindTenMinuteListByCollectionCodeAndTimeRange
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param beginTime {Date} 查询开始时间
     * @param endTime {Date} 查询结束时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getWindTenMinuteListByCollectionCodeAndTimeRange: function (dataRate, collectionCode, beginTime, endTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, beginTime, endTime);
        return this.invoke('ZDZ.GetWindTenMinuteListByCollectionCodeAndTimeRange', params, version, successFun, errorFun);
    },

    /**
     * 根据组合站点编号和时间段获取指定时间内的瞬时10分钟风
     * @method zdz_getWindTenMinuteCurrentByCollectionCodeAndQueryTime
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param queryTime {Date} 查询时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getWindTenMinuteCurrentByCollectionCodeAndQueryTime: function (dataRate, collectionCode, queryTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, queryTime);
        return this.invoke('ZDZ.GetWindTenMinuteCurrentByCollectionCodeAndQueryTime', params, version, successFun, errorFun);
    },

    /**
     * 根据站点获取时间段内的逐小时风向风速数据
     * @method zdz_getWindListByStationCodesAndTimeRange
     * @param dataRate
     * @param stationCodes
     * @param beginTime
     * @param endTime
     * @param successFun
     * @param errorFun
     * @returns {*}
     */
    zdz_getWindListByStationCodesAndTimeRange: function (dataRate, stationCodes, beginTime, endTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, stationCodes, beginTime, endTime);
        return this.invoke('ZDZ.GetWindListByStationCodesAndTimeRange', params, version, successFun, errorFun, false);
    },

    //----------------------------------
    //  自动站  气温  Temp
    //----------------------------------
    /**
     * 根据组合站点编号和时间段获取指定时间的气温
     * @method zdz_getAirtempCurrentByCollectionCodeAndQueryTime
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param queryTime {Date} 查询时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getAirtempCurrentByCollectionCodeAndQueryTime: function (dataRate, collectionCode, queryTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, queryTime);
        return this.invoke('ZDZ.GetAirtempCurrentByCollectionCodeAndQueryTime', params, version, successFun, errorFun);
    },

    /**
     * 根据组合站点编号和时间段获取指定时间内的最高气温
     * @method zdz_getAirtempCurrentByCollectionCodeAndQueryTime
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param beginTime {Date} 查询开始时间
     * @param endTime {Date} 查询结束时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getAirtempMaxByCollectionCodeAndTimeRange: function (dataRate, collectionCode, beginTime, endTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, beginTime, endTime);
        return this.invoke('ZDZ.GetAirtempMaxByCollectionCodeAndTimeRange', params, version, successFun, errorFun);
    },

    /**
     * 根据组合站点编号和时间段获取指定时间内的最低气温
     * @method zdz_getAirtempMinByCollectionCodeAndTimeRange
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param beginTime {Date} 查询开始时间
     * @param endTime {Date} 查询结束时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getAirtempMinByCollectionCodeAndTimeRange: function (dataRate, collectionCode, beginTime, endTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, beginTime, endTime);
        return this.invoke('ZDZ.GetAirtempMinByCollectionCodeAndTimeRange', params, version, successFun, errorFun);
    },

    /**
     * 根据组合站点编号和时间段获取指定时间内的平均气温
     * @method zdz_getAirtempAveByCollectionCodeAndTimeRange
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param beginTime {Date} 查询开始时间
     * @param endTime {Date} 查询结束时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getAirtempAveByCollectionCodeAndTimeRange: function (dataRate, collectionCode, beginTime, endTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, beginTime, endTime);
        return this.invoke('ZDZ.GetAirtempAveByCollectionCodeAndTimeRange', params, version, successFun, errorFun);
    },

    /**
     * 根据组合站点编号和时间获取minutes的变温
     * @method zdz_getAirtempDiffByCollectionCodeAndMinutesAndQueryTime
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param queryTime {Date} 查询时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getAirtempDiffByCollectionCodeAndMinutesAndQueryTime: function (dataRate, collectionCode, minutes, queryTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, minutes, queryTime);
        return this.invoke('ZDZ.GetAirtempDiffByCollectionCodeAndMinutesAndQueryTime', params, version, successFun, errorFun);
    },

    /**
     * 根据站号获取时间段内的温度列表
     * @method zdz_getAirtempListByStationCodesAndTimeRange
     * @param dataRate
     * @param stationCodes
     * @param beginTime
     * @param endTime
     * @param successFun
     * @param errorFun
     * @returns {*}
     */
    zdz_getAirtempListByStationCodesAndTimeRange: function (dataRate, stationCodes, beginTime, endTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, stationCodes, beginTime, endTime);
        return this.invoke('ZDZ.GetAirtempListByStationCodesAndTimeRange', params, version, successFun, errorFun, false);
    },


    //----------------------------------
    //  自动站  寒潮  Surfacetemp
    //----------------------------------

    zdz_getStrongCoolingByCollectionCodeAndQueryTime:function(dataRate,collectionCode,coolingType,queryTime, version, successFun, errorFun){
        var params = [];
        params = params.concat(dataRate,collectionCode,coolingType,queryTime);
        return this.invoke('ZDZ.GetStrongCoolingByCollectionCodeAndQueryTime', params, version, successFun, errorFun);
    },
    zdz_getStrongCoolingByCollectionCodeAndTimeRange:function(dataRate,collectionCode,coolingType,beginTime,endTime, version, successFun, errorFun){
        var params = [];
        params = params.concat(dataRate,collectionCode,coolingType,beginTime,endTime);
        return this.invoke('ZDZ.GetStrongCoolingByCollectionCodeAndTimeRange', params, version, successFun, errorFun);
    },

    //----------------------------------
    //  自动站  地温  Surfacetemp
    //----------------------------------
    /**
     * 获取组合站点(道面)某个时间点的地面温度数据
     * @param dataRate
     * @param collectionCode
     * @param queryTime
     * @param version
     * @param successFun
     * @param errorFun
     */
    zdz_getDMSurfaceAirtempCurrentByCollectionCodeAndQueryTime:function (dataRate, collectionCode, queryTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, queryTime);
        return this.invoke('ZDZ.GetDMSurfaceAirtempCurrentByCollectionCodeAndQueryTime', params, version, successFun, errorFun);
    },
    /**
     * 根据组合站点编号和时间段获取距离地表height的气温
     * @method zdz_getSurfacetempHCurrentByCollectionCodeAndQueryTime
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param height {number} 距离地表的高度值 （单位cm）
     * @param queryTime {Date} 查询时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getSurfacetempHCurrentByCollectionCodeAndQueryTime: function (dataRate, collectionCode, height, queryTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, height, queryTime);
        return this.invoke('ZDZ.GetSurfacetempHCurrentByCollectionCodeAndQueryTime', params, version, successFun, errorFun);
    },

    /**
     * 获取组合站点某个时间点的地面温度数据
     * @param dataRate
     * @param collectionCode
     * @param queryTime
     * @param version
     * @param successFun
     * @param errorFun
     */
    zdz_getSurfaceAirtempCurrentByCollectionCodeAndQueryTime:function (dataRate, collectionCode, queryTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, queryTime);
        return this.invoke('ZDZ.GetSurfaceAirtempCurrentByCollectionCodeAndQueryTime', params, version, successFun, errorFun);
    },

    //----------------------------------
    //  自动站  能见度  Visibility
    //----------------------------------

    /**
     * 根据组合站点编号和时间段获取指定时间内的最低能见度
     * @method zdz_getVisibilityMinByCollectionCodeAndTimeRange
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param beginTime {Date} 查询开始时间
     * @param endTime {Date} 查询结束时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getVisibilityMinByCollectionCodeAndTimeRange: function (dataRate, collectionCode, beginTime, endTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, beginTime, endTime);
        return this.invoke('ZDZ.GetVisibilityMinByCollectionCodeAndTimeRange', params, version, successFun, errorFun);
    },

    /**
     * 根据组合站点编号和时间段获取当前时间的能见度
     * @method zdz_getVisibilityCurrentByCollectionCodeAndQueryTime
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param queryTime {Date} 查询时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getVisibilityCurrentByCollectionCodeAndQueryTime: function (dataRate, collectionCode, queryTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, queryTime);
        return this.invoke('ZDZ.GetVisibilityCurrentByCollectionCodeAndQueryTime', params, version, successFun, errorFun);
    },

    /**
     * 根据站点获取时间段内的逐小时能见度
     * @method zdz_getVisibilityListByStationCodesAndTimeRange
     * @param dataRate
     * @param stationCodes
     * @param beginTime
     * @param endTime
     * @param successFun
     * @param errorFun
     * @returns {*}
     */
    zdz_getVisibilityListByStationCodesAndTimeRange: function (dataRate, stationCodes, beginTime, endTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, stationCodes, beginTime, endTime);
        return this.invoke('ZDZ.GetVisibilityListByStationCodesAndTimeRange', params, version, successFun, errorFun, false);
    },
    //----------------------------------
    //  自动站  气压  StaPressure
    //----------------------------------
    /**
     * 根据组合站点编号和时间段获取当前时间的本站气压
     * @method zdz_getStaPressureCurrentByCollectionCodeAndQueryTime
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param queryTime {Date} 查询时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getStaPressureCurrentByCollectionCodeAndQueryTime: function (dataRate, collectionCode, queryTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, queryTime);
        return this.invoke('ZDZ.GetStaPressureCurrentByCollectionCodeAndQueryTime', params, version, successFun, errorFun);
    },

    /**
     * 根据组合站点编号获取查询时间点的minutes分钟数内的本站变压
     * @method zdz_getStaPressureDiffByCollectionCodeAndMinutesAndQueryTime
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param minutes {number} 查询的分钟数
     * @param queryTime {Date} 查询时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getStaPressureDiffByCollectionCodeAndMinutesAndQueryTime: function (dataRate, collectionCode, minutes, queryTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, minutes, queryTime);
        return this.invoke('ZDZ.GetStaPressureDiffByCollectionCodeAndMinutesAndQueryTime', params, version, successFun, errorFun);
    },

    /**
     * 根据组合站点编号和时间段获取当前时间的海平面气压
     * @method zdz_getSeaPressureCurrentByCollectionCodeAndQueryTime
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param queryTime {Date} 查询时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getSeaPressureCurrentByCollectionCodeAndQueryTime: function (dataRate, collectionCode, queryTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, queryTime);
        return this.invoke('ZDZ.GetSeaPressureCurrentByCollectionCodeAndQueryTime', params, version, successFun, errorFun);
    },

    //----------------------------------
    //  自动站  湿度  RH
    //----------------------------------

    /**
     * 根据组合站点编号和时间段获取指定时间内的相对湿度
     * @method zdz_getRHCurrentByCollectionCodeAndQueryTime
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param queryTime {Date} 查询时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getRHCurrentByCollectionCodeAndQueryTime: function (dataRate, collectionCode, queryTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, queryTime);
        return this.invoke('ZDZ.GetRHCurrentByCollectionCodeAndQueryTime', params, version, successFun, errorFun);
    },

    /**
     * 获取相对湿度的逐小时数据
     * @method zdz_getRHListByStationCodesAndTimeRange
     * @param dataRate
     * @param stationCodes
     * @param beginTime
     * @param endTime
     * @param successFun
     * @param errorFun
     * @returns {*}
     */
    zdz_getRHListByStationCodesAndTimeRange: function (dataRate,stationCodes,beginTime,endTime,version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, stationCodes, beginTime,endTime);
        return this.invoke('ZDZ.GetRHListByStationCodesAndTimeRange', params, version, successFun, errorFun);
    },

    /**
     * 根据组合站点编号和时间段获取指定时间内的露点温度
     * @method zdz_getDewtempListByCollectionCodeAndTimeRange
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param beginTime {Date} 查询开始时间
     * @param endTime {Date} 查询结束时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getDewtempListByCollectionCodeAndTimeRange: function (dataRate, collectionCode, beginTime, endTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, beginTime, endTime);
        return this.invoke('ZDZ.GetDewtempListByCollectionCodeAndTimeRange', params, version, successFun, errorFun);
    },

    /**
     * 根据组合站点编号和时间段获取指定时间内的水汽压
     * @method zdz_getVapPressureListByCollectionCodeAndTimeRange
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param beginTime {Date} 查询开始时间
     * @param endTime {Date} 查询结束时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getVapPressureListByCollectionCodeAndTimeRange: function (dataRate, collectionCode, beginTime, endTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, beginTime, endTime);
        return this.invoke('ZDZ.GetVapPressureListByCollectionCodeAndTimeRange', params, version, successFun, errorFun);
    },

    /**
     * 根据组合站点编号和时间段获取指定时间内的风能数据
     * @method wndrsc_getDataByCollectionCodeAndTimeRange
     * @param dataRate {string} 返回数据的频率，如：'onehour/tenmiute'
     * @param collectionCode {string} 组合站code，如：'fuzhou_b'
     * @param beginTime {Date} 查询开始时间
     * @param endTime {Date} 查询结束时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    wndrsc_getDataByCollectionCodeAndTimeRange: function (dataRate, collectionCode, beginTime, endTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, beginTime, endTime);
        return this.invoke('WNDRSC.GetDataByCollectionCodeAndTimeRange', params, version, successFun, errorFun);
    },


    //----------------------------------
    //  自动站  闪电
    //----------------------------------
    /**
     * 根据时间与范围获取闪电数据
     * @param beginTime {Date} 开始时间
     * @param endTime {Date} 结束时间
     * @param beginLon {int} 起经度
     * @param endLon {int} 末经度
     * @param beginLat  {int} 起纬度
     * @param endLat  {int} 末纬度
     * @param successFun {function} 查询成功回调
     * @param errorFun {function} 查询失败回调
     * @returns {*}
     */
    thunder_getDataByTimeRangeAndLonLat: function (beginTime,endTime,beginLon,endLon,beginLat,endLat,version, successFun, errorFun) {
        var params = [];
        params = params.concat(beginTime,endTime,beginLon,endLon,beginLat,endLat);
        return this.invoke('Thunder.GetDataByTimeRangeAndLonLat', params, version, successFun, errorFun);
    },

    //----------------------------------
    //  实况图片    SC_ZDZ_ATC_P1,SC_ZDZ_RS24H_P1,SC_ZDZ_VISMIN24H_P1,SC_ZDZ_WEXMAX24H_P1
    //----------------------------------
    /**
     * 根据实况类型获取天气实况图片
     * @method zdz_getStainChartListByTypeCode
     * @param typeCode {string} 实况类型
     * @param listCount {int} 查询条数，默认-1
     * @param pageCount {int} 查询页数，默认-1
     * @param pageIndex {int} 查询目录，默认-1
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getStainChartListByTypeCode: function (typeCode, listCount, pageCount, pageIndex, version, successFun, errorFun) {
        var params = [];
        params = params.concat(typeCode, listCount, pageCount, pageIndex);
        return this.invoke('ZDZ.GetStainChartListByTypeCode', params, version, successFun, errorFun);
    },

    //----------------------------------
    //  ZDZ统计
    //----------------------------------
    /**
     * 年个例数列表
     * @param collectionCode 组合站编码
     * @param elementType 要素类型（rainstorm：暴雨）
     * @param levelValue 量级
     * @param stationCountStr 站数（>30,<=30,=30）
     * @param beginTime 开始时间
     * @param endTime 结束时间
     * @param successFun
     * @param errorFun
     * @returns {*}
     */
    zdz_getDisasterYearListByTimeRange: function (collectionCode,elementType,levelValue,stationCountStr,beginTime,endTime,version, successFun, errorFun) {
        var params = [];
        params = params.concat(collectionCode,elementType,levelValue,stationCountStr,beginTime,endTime);
        return this.invoke('ZDZ.GetDisasterYearListByTimeRange', params, version, successFun, errorFun);
    },

    /**
     * 查询站数达到标准的个例
     * @param collectionCode 组合站编码
     * @param timeType  1:时段选择; 2：历史同期
     * @param elementType 要素类型（rainstorm：暴雨）
     * @param levelValue 量级
     * @param stationCountStr 站数（>30,<=30,=30）
     * @param beginTime 开始时间
     * @param endTime 结束时间
     * @param successFun
     * @param errorFun
     * @returns {*}
     */
    zdz_getDisasterDayListByTimeRange: function (collectionCode,timeType,elementType,levelValue,stationCountStr,beginTime,endTime,version, successFun, errorFun) {
        var params = [];
        params = params.concat(collectionCode,timeType,elementType,levelValue,stationCountStr,beginTime,endTime);
        return this.invoke('ZDZ.GetDisasterDayListByTimeRange', params, version, successFun, errorFun);
    },


    /**
     * 查询站数达到标准的具体站点信息
     * @param collectionCode 组合站编码
     * @param elementType 要素类型（rainstorm：暴雨）
     * @param levelValue 量级
     * @param queryTime 查询时间
     * @param successFun
     * @param errorFun
     * @returns {*}
     */
    zdz_getDisasterStationListByQueryTime: function (collectionCode,elementType,levelValue,queryTime,version, successFun, errorFun) {
        var params = [];
        params = params.concat(collectionCode,elementType,levelValue,queryTime);
        return this.invoke('ZDZ.GetDisasterStationListByQueryTime', params, version, successFun, errorFun);
    },

    /**
     * 根据时间范围获取降水距平数据
     * @method zdzstat_getRainSumAnomalyByCollectionCodeAndTimeRange
     * @param dataRate {string} 返回数据的频率，如：'oneday08 （08-08雨量）'
     * @param collectionCode {string} 组合站编码，如：'jiangxi_county'
     * @param beginTime {Date} 开始时间
     * @param endTime {Date} 结束时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdzstat_getRainSumAnomalyByCollectionCodeAndTimeRange: function (dataRate, collectionCode, beginTime, endTime,version, successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate, collectionCode, beginTime, endTime);
        return this.invoke('ZDZSTAT.GetRainSumAnomalyByCollectionCodeAndTimeRange', params, version, successFun, errorFun);
    },

    /**
     * 天数统计
     * @method zdz_getDisasterDaysCountByCollectionCodeAndTimeRange
     * @param dataRate {string} 返回数据的频率，如：'oneday08 （08-08雨量）'
     * @param elementType {string} 要素类型（rainstorm：暴雨）
     * @param collectionCode {string} 组合站编码，如：'jiangxi_county'
     * @param 量级 {decimal} 组合站编码，如：'0.1 小雨以上， 10 中雨以上。。。'
     * @param days {string} 天数（>30,<=30,=30）
     * @param beginTime {Date} 开始时间
     * @param endTime {Date} 结束时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getDisasterDaysCountByCollectionCodeAndTimeRange: function (dataRate, elementType, collectionCode, levelValue, days, beginTime, endTime,version, successFun, errorFun) {
        var params = [];
        levelValue=new Decimal(levelValue);
        params = params.concat(dataRate, elementType, collectionCode, levelValue, days, beginTime, endTime);
        return this.invoke('ZDZ.GetDisasterDaysCountByCollectionCodeAndTimeRange', params, version, successFun, errorFun);
    },

    /**
     * 组合站极值统计
     * @method zdz_getExtremeDataByCollectionCodeAndTimeRanges
     * @param collectionCode {string} 组合站编码，如：'jiangxi_county'
     * @param elementType {string} 要素类型（rainstorm：暴雨）
     * @param timeType  {int} 1表示连续时间，2表示历史同期
     * @param extremeType {string}（max_everyyear,avg_everyyear,max, avg）
     * @param beginTime {Date} 开始时间
     * @param endTime {Date} 结束时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getExtremeDataByCollectionCodeAndTimeRanges: function (collectionCode, elementType, timeType, extremeType, beginTime, endTime,version, successFun, errorFun) {
        var params = [];
        params = params.concat(collectionCode, elementType, timeType, extremeType, beginTime, endTime);
        return this.invoke('ZDZ.GetExtremeDataByCollectionCodeAndTimeRanges', params, version, successFun, errorFun);
    },

    /**
     * 单站极值统计
     * @method zdz_getExtremeDataListByStationCodeAndTimeRanges
     * @param stationCode {string} 单站编码
     * @param elementType {string} 要素类型（rainstorm：暴雨）
     * @param timeType  {int} 1表示连续时间，2表示历史同期
     * @param extremeType {string}（max_everyyear,avg_everyyear,max, avg）
     * @param beginTime {Date} 开始时间
     * @param endTime {Date} 结束时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    zdz_getExtremeDataListByStationCodeAndTimeRanges: function (stationCode, elementType, timeType, extremeType, beginTime, endTime,version, successFun, errorFun) {
        var params = [];
        params = params.concat(collectionCode, elementType, timeType, extremeType, beginTime, endTime);
        return this.invoke('ZDZ.GetExtremeDataListByStationCodeAndTimeRanges', params, version, successFun, errorFun);
    },


    /**
     * 获取某一时间的海洋浮标站点情况
     * 参数dataRate，collectionCode，queryTime
     */
    buoy_getDataByCollectionCodeAndQueryTime: function ( dataRate, collectionCode, queryTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat( dataRate, collectionCode, queryTime);
        return this.invoke("SEABUOY.GetDataByCollectionCodeAndQueryTime", params,version, successFun, errorFun);
    },
    /**
     * 获取某一时间单站浮标列表数据
     * dataRate、stationCodes、queryTime
     */
    buoy_getDataByStationCodesAndQueryTime: function ( dataRate, stationCodes,queryTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat( dataRate, stationCodes, queryTime);
        return this.invoke("SEABUOY.GetDataByStationCodesAndQueryTime", params, version, successFun, errorFun);
    },


    /**
     * 灾害统计详细
     * @param dataRate
     * @param element
     * @param stationCode
     * @param beginTime
     * @param endTime
     * @param version
     * @param successFun
     * @param errorFun
     * @returns {*}
     */
    zdz_getWSDataByElementAndStationCodeAndTimeRange:function (dataRate,element,stationCode,beginTime,endTime,version,successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate,element,stationCode,beginTime,endTime);
        return this.invoke('ZDZ.GetWSDataByElementAndStationCodeAndTimeRange', params, version,successFun, errorFun);
    },
    /**
     * 灾害统计
     * @param dataRate
     * @param element
     * @param collectionCode_county
     * @param collectionCode_all
     * @param beginTime
     * @param endTime
     * @param version
     * @param successFun
     * @param errorFun
     */
    zdz_getWSAndCountByElementAndCollectionCodeAndTimeRange:function (dataRate,element,collectionCode_county,collectionCode_all,beginTime,endTime,version,successFun, errorFun) {
        var params = [];
        params = params.concat(dataRate,element,collectionCode_county,collectionCode_all,beginTime,endTime);
        return this.invoke('ZDZ.GetWSAndCountByElementAndCollectionCodeAndTimeRange', params, version,successFun, errorFun);
    },


    /**
     * 获取组合站点某个时间点的积雪深度数据
     * @param dataRate
     * @param collectionCode
     * @param queryTime
     * @param version
     * @param successFun
     * @param errorFun
     * @returns {*}
     */
    zdz_getSnowDepthCurrentByCollectionCodeAndQueryTime:function(dataRate,collectionCode,queryTime,version,successFun, errorFun){
        var params = [];
        params = params.concat(dataRate,collectionCode,queryTime);
        return this.invoke('ZDZ.GetSnowDepthCurrentByCollectionCodeAndQueryTime', params, version,successFun, errorFun);
    },

    /**
     * 单站极值统计
     * @method zdz_getExtremeDataListByStationCodeAndTimeRanges
     * @param typeCode {string} 产品类型, 如：‘FIN_MATERIAL_R_P’
     * @param listCount {Int}（传1时取最新的）
     * @param pageCount {Int}
     * @param pageIndex  {Int}
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    complex_getTimeListByTypeCodeAndCount: function (typeCode, listCount, pageCount, pageIndex,version, successFun, errorFun) {
        var params = [];
        params = params.concat(typeCode, listCount, pageCount, pageIndex);
        return this.invoke('Complex.GetTimeListByTypeCodeAndCount', params, version, successFun, errorFun);
    },


    //----------------------------------
    //  AQI
    //----------------------------------

    /**
     * 单站点AQI实况
     * @method aqi_getDataByStationCode
     * @param stationCodes {string} 站号，如：'58847'/'58847,58846'
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    aqi_getDataByStationCode: function (stationCodes, version, successFun, errorFun) {
        var params = [];
        params = params.concat(stationCodes);
        return this.invoke('AQI.GetDataByStationCode', params, version, successFun, errorFun);
    },

    /**
     * 获取指定时间段内的单站点AQI实况
     * @method aqi_getDataListByStationCodeAndTimeRange
     * @param stationCodes {string} 站号，如：'58847'/'58847,58846'
     * @param beginTime {Date} 查询开始时间
     * @param endTime {Date} 查询结束时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    aqi_getDataListByStationCodeAndTimeRange: function (stationCodes, beginTime, endTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(stationCodes, beginTime, endTime);
        return this.invoke('AQI.GetDataListByStationCodeAndTimeRange', params, version, successFun, errorFun);
    },

    /**
     * 单站点AQI预报
     * @method aqi_getFDataByStationCode
     * @param stationCodes {string} 站号，如：'58847'/'58847,58846'
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    aqi_getFDataByStationCode: function (stationCodes, version, successFun, errorFun) {
        var params = [];
        params = params.concat(stationCodes);
        return this.invoke('AQI.GetFDataByStationCode', params, version, successFun, errorFun);
    },

    /**
     * 单站点AQI时间段内的预报
     * @method aqi_getFDataListByStationCodeAndTimeRange
     * @param stationCodes {string} 站号，如：'58847'/'58847,58846'
     * @param beginTime {Date} 查询开始时间
     * @param endTime {Date} 查询结束时间
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    aqi_getFDataListByStationCodeAndTimeRange: function (stationCodes, beginTime, endTime, version, successFun, errorFun) {
        var params = [];
        params = params.concat(stationCodes, beginTime, endTime);
        return this.invoke('AQI.GetFDataListByStationCodeAndTimeRange', params, version, successFun, errorFun);
    },

    /**
     * 通过sql语句获取数据(自动站数据)
     * @method db_getDataTable
     * @param sql {string} sql语句
     * @param pageCount {Date} 默认填写-1
     * @param pageIndex {Date} 默认填写-1
     * @param successFun {function} 查询成功回调
     * @param [errorFun] [funtion] 查询失败回调
     * @returns {*} 查询返回数据
     */
    db_getDataTable: function (sql, pageCount, pageIndex, version, successFun, errorFun) {
        var params = [];
        params = params.concat(sql, pageCount, pageIndex);
        return this.invoke('DB.GetDataTable', params, version, successFun, errorFun);
    }


});

/**
 * 台风 数据代理
 *
 * Update Note：
 *      + v1.2.6 ：Created
 *
 * @class SW.Rpc.TypProxy
 * @extends SW.Rpc.BaseProxy
 */
SW.Rpc.TypProxy = SW.Rpc.BaseProxy.extend({

    options:{
        serviceUrl: '/Weather/TYP.aspx'
    },


    /**
     * 获取当前台风
     * @returns {*}
     */
    typhoon_getTyphoonCur: function (version, successFun, errorFun) {
        var params = [];
        return this.invoke("Typhoon.GetTyphoonCur", params, version, successFun, errorFun);
    },

    /**
     * 获取年份列表
     * @return {*}
     */
    typhoon_getYearList:function (version, successFun, errorFun) {
        return this.invoke("Typhoon.GetTyphoonYearList", version, successFun, errorFun);
    },

    /**
     * 获取指定年份的台风列表
     * @return {*}
     */
    typhoon_getTyphoonListByYear:function (year, version, successFun, errorFun) {
        return this.invoke("Typhoon.GetTyphoonListByYear",[year], version, successFun, errorFun);
    },


    /**
     * 根据台风ID获取台风详细
     */
    typhoon_getTyphoonDetailByTyphoonID: function (typhoonID, version, successFun, errorFun) {
        var params = [];
        params = params.concat(typhoonID);
        return this.invoke("Typhoon.GetTyphoonDetailByTyphoonID", params, version, successFun, errorFun);
    },

    /**
     * 根据台风code获取台风详细
     */
    typhoon_getTyphoonDetailByTyphoonCode: function (typhoonCode, version, successFun, errorFun) {
        var params = [];
        params = params.concat(typhoonCode);
        return this.invoke("Typhoon.GetTyphoonDetailByTyphoonCode", params, version, successFun, errorFun);
    },

    /**
     *
     * 根据台风ID获取台风所有预报路径点
     * @param typhoonId 台风实际路径点ID
     * @return
     *
     *
     */
    typhoon_getTyphoonAllForecastDetail: function (typhoonId, version, successFun, errorFun) {
        var params = [];
        params = params.concat(typhoonId);
        return this.invoke("Typhoon.GetTyphoonAllForecastDetail", params, version, successFun, errorFun);
    }
});


/**
 * web socket 数据代理
 *
 * Features :
 *
 * Update Note：
 *      + v1.2.4 ：Created
 *
 *
 * @class Sun.SocketProxy
 */
SW.Rpc.SocketProxy=Sun.Evented.extend({
    options:{
        messageServer:"",
        messageTheme:"",
        messageStructFn:null
    },

    initialize:function (options) {
        Sun.setOptions(this,options);
    },
    start:function () {
        if(!this.socket)
            this._createSocket();
    },
    close:function () {
        if(this.socket){
            this.socket.close();
        }
    },

    _createSocket:function () {
        var self=this;
        console.info("开始连接总线");
        var socket=this.socket = new ReconnectingWebSocket(self.options.messageServer, 'stomp');
        socket.timeoutInterval = 5000;
        socket.onopen = function () {
            console.info("总线连接成功，开始订阅主题");
            socket.send('CONNECT\n\n\0');
            socket.send('SUBSCRIBE\ndestination:/topic/'+self.options.messageTheme+'\n\nack:auto\n\n\0');
        };

        socket.onmessage = function (e) {
            var data = e.data.split('\n');
            if(data.length>0){
                if (data[0] == "MESSAGE") {
                    var mes = data[data.length - 1];
                    // Tip:消息返回会有一个奇怪的字符跟在后面，导致json解析出错，暂时先直接把这个字符剔除来解决这个问题
                    mes = mes.slice(0,mes.length-1);
                    mes = JSON.parse(mes);
                    self.fire("message",{data:mes});
                }
                else if(data[0] == "CONNECTED"){
                    console.info("主题订阅成功");
                    self.fire("connected");
                }
            }
            // var data=/\n\n(.*).$/.exec(e.data);
            // try {
            //     data=JSON.parse(data[1]);
            // }
            // catch (e){
            //     data=null;
            // }
            // finally {
            //     self.fire("message",{data:data});
            // }
        };

        socket.onerror  = function (e) {
            console.info("总线连接错误");
        };

        socket.onclose = function (e) {
            console.info("总线连接关闭");
        };
    },
    // 获取消息结构体
    _getMessageStruct:function (data) {
        var addToken = data.addToken || '';
        var sender=data.sender||'';
        var code=data.code||'';
        var mesSN=data.messageSN||'';
        var content=data.content||'';
        return {
            "MessageTime":new Date().format('yyyy-MM-dd hh:mm:ss'),
            "MessageCode":code,
            "MessageToken":code+"|"+new Date().format('yyyyMMddhhmmss')+"|"+addToken,
            "MessageSender":sender,
            "MessageSN":mesSN,
            "MessageReceiver":"",
            "MessageContent":content
        }
    },
    send:function (data) {
        var getMesStructFn = this.options.messageStructFn || this._getMessageStruct;
        var mes = getMesStructFn(data);
        this.socket.send('SEND\ndestination:/topic/'+this.options.messageTheme+'\n\n' + JSON.stringify(mes) + '\0');
        return mes;
    }
});
/**
 * web service 3.0 基础数据代理
 *
 * Features :
 *      1. XMLHttpRequest为核心取数方式
 *      2. 仅支持promise类ws,invoke方法返回Promise对象，即支持promise标准用法
 *      3. 具体接口根据项目直接使用SW.Rpc3_0.BaseProxy或继承SW.Rpc3_0.BaseProxy扩展使用
 *
 * Update Note：
 *      + v1.3.1 ：Created
 *
 * @class SW.Rpc3_0.BaseProxy
 */
SW.Rpc3_0.BaseProxy = Sun.Class.extend({
    options: {

        /**
         * webservice 根地址
         * @property rootURL
         * @type {string}
         * @default ''
         */
        rootURL: '',

        /**
         * 用户名
         * @property user
         * @type {string}
         * @default 'admin'
         */
        user:'admin',
        /**
         * 密码
         * @property password
         * @type {string}
         * @default '111'
         */
        password:'111',
        /**
         * 请求包版本
         * @property version
         * @type {string}
         * @default '3'
         */
        version:'3',

        /**
         * loading tip 等待提示
         * 传入对象需含有show and hide 方法，如$('#id-name')/$('.class-name')
         * @property loading
         * @default null
         */
        loadingTip: null,

        /**
         * 是否为调试状态，调试状态下将会打印加载数据信息
         *
         * 注意：在系统正式运行时必需将此属性设为false
         *
         * @property debug
         * @type {boolean}
         * @default false
         */
        debug: false,

        /**
         * webservice
         * @property ws
         * @default SW.ws3_0_Promise()
         */
        ws: SW.ws3_0_Promise()
    },



    initialize: function (options) {
        Sun.setOptions(this, options);
    },

    /**
     * 调用数据
     * @method invoke
     * @param method {string} 接口名 eg:'test/StrTest'
     * @param version {string} 接口版本号 eg:'1'
     * @param params {object} 参数
     *                        eg : {key1:value1,key2:value2,...}
     *                        tip: value可接受Date类型，会自动转为要求的字符串格式
     * @param returnType {String} [optional] 返回类型，如不穿则默认为ws的options中的returnType
     * @protected
     * @returns {*}
     */
    invoke: function (method, version, params,returnType) {
        return this.options.ws.invoke(method, version, params,returnType, this.options);
    },

    /**
     * 停止自身代理的数据调用
     * @method close
     */
    close: function () {
        this.options.ws.close();
    }
});

/**
 * 台风 数据加工代理
 *
 * Update Note：
 *      + v1.2.6 ：Created
 *
 * @class SW.Proxy.TypProxy
 * @extends Sun.Evented
 */
SW.Proxy.TypProxy=Sun.Evented.extend({

    initialize:function (options) {
        Sun.setOptions(this,options);
        this._typhoonProxy=new SW.Rpc.TypProxy({rootURL:options.rootURL});
    },

    /**
     * 获取当前台风
     * @param fn
     */
    getCurrentTyphoon:function (fn) {
        var that=this;
        this._typhoonProxy.typhoon_getTyphoonCur(1,function (data) {
            that._parseCurTyphoonData(data,fn);
        });
    },

    /**
     * 根据台风数据项，获取台风的明细
     */
    getTyphoonDetail:function (typhoonListItem, fn) {
        var self=this;
        this._typhoonProxy.typhoon_getTyphoonDetailByTyphoonID(typhoonListItem.ID,1,function (data) {
            typhoonListItem["DETAIL"]=data;
            self._typhoonProxy.typhoon_getTyphoonAllForecastDetail(typhoonListItem.ID,1,function (data) {
                typhoonListItem["FORECAST_DETAIL"]=self._parseForecastData(data,typhoonListItem["DETAIL"],typhoonListItem["NAME"],typhoonListItem["ID"]);
                fn(typhoonListItem);
            })
        })
    },

    _parseForecastData:function (forecastData,detailData,name,id) {
        var stations = [], ac, i, j, k, o, o1, tf;
        var result={};
        forecastData.forEach(function (item) {
            item.TYPHOON_NAME = name;
            item.TYPHOON_ID = id;
            if (!result[item["TYPHOONDETAILID"]])
                result[item["TYPHOONDETAILID"]] = {};
            ac = result[item["TYPHOONDETAILID"]];
            if (!ac[item["FORECASTSTATION"]])
                ac[item["FORECASTSTATION"]] = [];
            ac = ac[item["FORECASTSTATION"]];
            ac.push(item);
            if (stations.indexOf(item["FORECASTSTATION"]) == -1)
                stations.push(item["FORECASTSTATION"]);
        });

        for (i = 0; i < detailData.length; i++) {
            o =detailData[i];
            ac = result[o["ID"]];
            if (!ac)
                ac = result[o["ID"]] = {};
            for (j = 0; j < stations.length; j++) {
                if (!ac[stations[j]]) {
                    //如果没有，则向下遍历，直到找出该站点的预报路径，添加到该路径点的预报集合中
                    for (k = i + 1; k < detailData.length; k++) {
                        o1 = detailData[k];
                        tf = result[o1["ID"]];
                        if (tf && tf[stations[j]]) {
                            ac[stations[j]] = tf[stations[j]];
                            break;
                        }
                    }
                }
            }
        }
        return result;
    },

    _parseCurTyphoonData:function (typhooneList,fn,index) {
        index = isNaN(index) ? 0 : index+1;
        if(index>=typhooneList.length){
            fn(typhooneList);
            return;
        }
        var self=this;
        this.getTyphoonDetail(typhooneList[index],function (data) {
            typhooneList[index] = data;
            self._parseCurTyphoonData(typhooneList,fn,index);
        })
    }
});