/**
 * Created by Ning on 2017/4/13.
 */
var hwc = {
     version:"1.0.0"
};
function expose() {
    var oldhwc = window.hwc;

    hwc.noConflict = function () {
        window.hwc = oldhwc;
        return this;
    };
    window.hwc = hwc;
}
// define Sun for Node module pattern loaders, including Browserify
if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = hwc;

// define Sun as an AMD module
} else if (typeof define === 'function' && define.amd) {
    define(hwc);
}

// define Sun as a global Sun variable, saving the original Sun to restore later if needed
if (typeof window !== 'undefined') {
    expose();
}



/**
 * 自动站数据处理
 * ---------------------------------------------------------
 */
/**
 * 过滤自动站
 * @param data
 * @param level    prov/city/county
 * @param name
 */
hwc.filterZdz=function (data,level,name,mode) {
    if(!_.isArray(name))
        name=[name];
    var data=_.filter(data,function (item) {
        var a=_.find(name,function (item1) {
            return  hwc.comparisonZdzName(item1,level,item.CITY,item.COUNTY,mode);
        });
        return a!=null;
    })
    return data;
};
/**
 * 是否国家站
 * @param data
 */
hwc.isCountryZdz=function (data,countryCodes) {
    if(!countryCodes)
        return (data["STATIONLEVEL_TYPE"]=="011"||data["STATIONLEVEL_TYPE"]=="012"||data["STATIONLEVEL_TYPE"]=="013")
    else
        return countryCodes.indexOf(data["STATIONCODE"])!=-1;
}
/**
 * 比对name和自动站的市、县
 * @param name
 * @param propertiesName
 * @return {boolean}
 */
hwc.comparisonZdzName=function(name,level,city,county,mode) {

    if(level=="city"){
        if(name==city)
            return true;
        return hwc.getPureAreaName(name)==hwc.getPureAreaName(city);
    }
    else if(level=="county"){
        if(!county)
            return false;
        if(name==county)
            return true;
        if(mode==1){
            if(name.indexOf("市区")!=-1){
                //        return hwc.getPureAreaName(name)==hwc.getPureAreaName(city)&&((county.indexOf("区")==(county.length-1))||(hwc.getPureAreaName(name)==hwc.getPureAreaName(county)&&(county.indexOf("县")==(county.length-1))));
                return hwc.getPureAreaName(name)==hwc.getPureAreaName(city)&&((county.indexOf("区")==(county.length-1)));
            }
            else {
                return hwc.getPureAreaName(county)==hwc.getPureAreaName(name);
            }
        }
    }
    else{
        return true;
    }
}
/**
 * 获取国家站和区域站的分组
 * @param data
 * @param [countryCodes]  若有该参数则用countryCodes判定，若没有则使用STATIONLEVEL_TYPE判定 * @returns {
 *              nation:[],
 *              area:[]
 *          }
 */
hwc.getZdzGroup=function (data,countryCodes) {
    var result={};
    result["nation"]=_.filter(data,function (item) {
        return hwc.isCountryZdz(item,countryCodes);
    })
    result["area"]=_.filter(data,function (item) {
        return !hwc.isCountryZdz(item,countryCodes);
    })
    return result;
}
/**
 * 返回自动站字段
 * @param element
 * @param field
 * @param multiIndex
 * @param windPowerEnable
 * @return {*}
 */
hwc.getZdzField=({element,field,multiIndex,windPowerEnable})=>{
    if(field==null)
        return null;

    if(_.isArray(field)&&_.isArray(field[0])){
        var multiIndex=multiIndex?multiIndex[0]:0;
        field=field[multiIndex];
    }

    if(element=="wind")
        field=windPowerEnable?field[2]:field[1];
    return field;
}


/**
 * 过滤数据处理
 * ---------------------------------------------------------
 */
/**
 * 返回过滤项的描述
 * @param filterValue  {min, equalMin, max, equalMax}
 */
hwc.getFilterDesc=function (filterValue) {
    if(!hwc.isVoid(filterValue.min)&&!hwc.isVoid(filterValue.max)){
        return filterValue.min+"~"+filterValue.max;
    }
    else if(hwc.isVoid(filterValue.min)&&hwc.isVoid(filterValue.max)){
        return "~";
    }
    else if(hwc.isVoid(filterValue.min)){
        return (filterValue.equalMax?"≤":"<")+filterValue.max;
    }
    else if(hwc.isVoid(filterValue.max)){
        return (filterValue.equalMin?"≥":">")+filterValue.min;
    }
}

/**
 * 指定数据是否在过滤值内
 * @param data
 * @param filterValue  {min, equalMin, max, equalMax}   |
 *                      {
 *                          relation:"and",
 *                          data:[
 *                              {
  *                                relation:"or",
 *                                 data:[filterValue,filterValue]
 *                              },
 *                              filterValue
 *                          ]
 *                       }
 */
hwc.isFilter=function (data,filterValue) {
    //如果有逻辑关系
    if(filterValue.relation!=null){
        var b=_.some(filterValue.data,function (item) {
            //如果是且关系
            var t=hwc.isFilter(data,item);
            if(filterValue.relation=="and"){
                return !t;
            }
            else if(filterValue.relation=="or"){
                return t;
            }
        })
        if(filterValue.relation=="and")
            return !b;
        else{
            return b;
        }
    }

    if(_.isNaN(data)||data==null)
        return false;

    var b=false,g=true;
    if(!hwc.isVoid(filterValue.min)){
        if(filterValue.equalMin)
            g=b=(data>=filterValue.min);
        else
            g=b=(data>filterValue.min);
    }
    if(g&&(!hwc.isVoid(filterValue.max)))
        if(filterValue.equalMax)
            b=(data<=filterValue.max);
        else
            b=(data<filterValue.max);
    return b;
}

/**
 *  两个filter的集合关系
 * @param filter1
 * @param filter2
 * @return  {result:-1相离|0相交|1 相等|2 A包含B|3B包含A,filter:相交的部份}
 *
 */
hwc.filterRelation=function (filter1,filter2) {
    filter1=_.clone(filter1);
    filter2=_.clone(filter2);
    if(isNaN(filter1.max)||filter1.max==null)
        filter1.max=Number.POSITIVE_INFINITY;
    if(isNaN(filter2.max)||filter2.max==null)
        filter2.max=Number.POSITIVE_INFINITY;
    if(isNaN(filter1.min)||filter1.min==null)
        filter1.min=Number.NEGATIVE_INFINITY;
    if(isNaN(filter2.min)||filter2.min==null)
        filter2.min=Number.NEGATIVE_INFINITY;

    var result=0;
    var filter;
    if(filter1.max==filter2.max&&filter2.min==filter1.min&&filter1.equalMax==filter2.equalMax&&filter1.equalMin==filter2.equalMin){
        result= 1;
    }
    else if(hwc.filterCompare(filter1,"max",filter2,"min","<")||hwc.filterCompare(filter2,"max",filter1,"min","<")){
        result= -1;
    }
    else if(hwc.filterCompare(filter1,"min",filter2,"min","<=")&&hwc.filterCompare(filter1,"max",filter2,"max",">=")){
        result= 2;
    }
    else if(hwc.filterCompare(filter1,"min",filter2,"min",">=")&&hwc.filterCompare(filter1,"max",filter2,"max","<="))
        result= 3;
    else{
        result= 0;
        filter= {};
        filter.max=Math.min(filter1.max,filter2.max);
        filter.min=Math.max(filter1.min,filter2.min);
        if(filter.max==filter1.max){
            filter.equalMax=filter1.equalMax
        }
        else{
            filter.equalMax=filter2.equalMax
        }

        if(filter.min==filter1.min){
            filter.equalMin=filter1.equalMin
        }
        else{
            filter.equalMin=filter2.equalMin
        }

        if(filter.max==Number.POSITIVE_INFINITY)
            filter.max=NaN;
        if(filter.min==Number.NEGATIVE_INFINITY)
            filter.min=NaN;
    }
    return {result:result,filter:filter};
}
/**
 * 过滤比较
 */
hwc.filterCompare=function (filter1,el1,filter2,el2,compare) {
     var c1=filter1[el1];
     var c2=filter2[el2];
     if(c1==c2){
         var a1=hwc.line2camel("equal_"+el1);
         var a2=hwc.line2camel("equal_"+el2);
         if(filter1[a1])
             c1++;
         if(filter2[a2])
             c2++;
     }

     if(compare==">")
         return c1>c2;
    else  if(compare==">=")
         return c1>=c2;
    else if(compare=="<")
         return c1<c2;
    else if(compare=="<=")
         return c1<=c2;
}

/**
 * 过滤值
 * @param data
 * @param filterValue {field,min, equalMin, max, equalMax}
 */
hwc.filterValue=function (data,filterValue) {
    var data=_.filter(data,function (item) {
        return hwc.isFilter(item[filterValue.field],filterValue);
    })
    return data;
}
/**
 * 过滤9999/999.9无效值
 * @param value
 * @returns {*}
 */
hwc.fitlerVoid=function (value) {
    if(value==999.9||value==9999)
        return null;
    return value;
}

/**
 * 图例数据处理
 * ---------------------------------------------------------
 */
/**
 * 获取指定值的图例数据项的索引
 * @param legendData
 * @param value
 */
hwc.getLegendIndexOf=function (legendData,value) {
    var item=_.findIndex(legendData,function (item) {
        return hwc.isFilter(value,item);
    })
    return item;
}
/**
 * 获取指定值的图例数据项
 * @param legendData
 * @param value
 */
hwc.getLegendItem=function (legendData,value) {
    var item=_.find(legendData,function (item) {
        return hwc.isFilter(value,item);
    })
    return item;
}

/**
 * jq操作
 * ---------------------------------------------------------
 */
hwc.layers={};
/**
 * 获取模板值
 * @param data
 * @param name
 * @return {{}}
 */
hwc.getTemplateData=function (data,name) {
    var o={},name=_.isUndefined(name)?"":name+"_",s,d;
    if(_.isArray(data)){
        for(var i=0;i<data.length;i++)
        {
            d=data[i];
            for(s in d){
                if(_.isArray(d[s]))
                    o=_.extend(this.getTemplateData(d[s],name+s+"_"+i),o)
                else
                    o[name+s+"_"+i]=d[s];
            }
        }
    }
    else{
        for(s in data)
        {

            if(_.isArray(data[s])){
                o=_.extend(this.getTemplateData(data[s],s),o)
            }
            else{
                o[name+s]=data[s];
            }
        }
    }
    return o;
}
/**
 * dom快捷操作
 */
hwc.docWork=function () {
    $(document).on("click",".u-popCloseBtn",function () {
        hwc.layers[$(this).data("belong")].closePopup();
    })

    $(document).on("click",".j-exportExcel",function () {
        hwc.excelExport($(this).data("belong"));
    })


    $(document).on("focus",".j-timeBox",function () {
        var that=$(this);
        var dateFmt="yyyy-MM-dd HH:mm";
        var dateFmt1="YYYY-MM-DD HH:mm";
        var prec=$(this).data("prec");
        if(prec=="H"){
            dateFmt="yyyy-MM-dd HH时";
            dateFmt1="YYYY-MM-DD HH时";
        }
        else if(prec=="D"){
            dateFmt="yyyy-MM-dd";
            dateFmt1="YYYY-MM-DD";
        }

        if($(this).data("date_fmt")){
            dateFmt=$(this).data("date_fmt");
        }
        if($(this).data("text_date_fmt")){
            dateFmt1=$(this).data("text_date_fmt");
        }

        var minDate=null;
        if($(this).data("mindate")!=null)
            minDate=moment().add(Number($(this).data("mindate")),"h").format(dateFmt1);
        var maxDate= 0;
        if($(this).data("maxdate")!=null)
            maxDate=Number($(this).data("maxdate"));
        if(maxDate==9999){
            maxDate=null;
        }
        else{
            maxDate=moment().add(maxDate,"h").format(dateFmt1);
        }

        var o={
            isShowClear:false,
            dateFmt:dateFmt,
            onpicked: function (dp) {
                that.val(dp.cal.getNewDateStr()).change();
            }
        };

        if(minDate)
            o.minDate=minDate;
        if(maxDate)
            o.maxDate=maxDate;
        WdatePicker(o);
    })
};
/**
 * 初始化日期组件
 */
hwc.initTimeBox=function (jq) {
    if(jq==null)
        jq=$(".j-timeBox");
    else
        jq=_.getJq(jq);
    jq.each(function () {
        var h=Number($(this).data("default"))||0;
        var dateFmt="YYYY-MM-DD HH:mm";
        var prec=$(this).data("prec");
        if(prec=="H"){
            dateFmt="YYYY-MM-DD HH时";
        }
        else if(prec=="D"){
            dateFmt="YYYY-MM-DD";
        }

        if($(this).data("text_date_fmt")){
            dateFmt=$(this).data("text_date_fmt");
        }

        $(this).val(moment().add(h,"h").format(dateFmt));
    })
}
/**
 * 初始化滚动条组件
 */
hwc.initComps=function () {
    $(".j-scroll").each(function () {
        var ops={
            touchbehavior: false,
            cursorcolor: "#7C7C7C",
            cursoropacitymax: 0.5,
            cursorwidth: 8,
            railpadding: {
                top: 0,
                right: 0,
                left: 0,
                bottom: 0
            },
            railhoffset:{
                top: 0,
                left: 0,
            },
            zindex:1000000
        };


        var autohidemode=$(this).data("autohide")||0;
        ops["autohidemode"]=!!autohidemode;
        var horizrailenabled=$(this).data("h")||0;
        ops["horizrailenabled"]=!!horizrailenabled;
        ops["railpadding"]["top"]=$(this).data("top")||0;
        ops["railpadding"]["bottom"]=$(this).data("bottom")||0;
        ops["railpadding"]["left"]=$(this).data("left")||0;
        ops["railpadding"]["right"]=$(this).data("right")||0;
        ops["railhoffset"]["top"]=$(this).data("offsettop")||0;
        ops["railhoffset"]["bottom"]=$(this).data("offsetbottom")||0;
        ops["railhoffset"]["left"]=$(this).data("offsetleft")||0;
        ops["railhoffset"]["right"]=$(this).data("offsetright")||0;
        var wrap=$(this).data("wrap");
        if(wrap==null){
            $(this).niceScroll(ops);
        }
        else{
            ops["bouncescroll"]=false;
            $(this).niceScroll(_.getJq(wrap),ops);
        }
    })
}
/**
 * 创建时间控件
 * @param id
 * @param fn
 * @param options
 */
hwc.createTimeBox=function (id,fn,options) {
    id=id instanceof jQuery?id:$("#"+id);
    id.focus(function () {
        var that=$(this);
        var options=_.extend({
            isShowClear:false,
            dateFmt: "yyyy-MM-dd HH:mm",
            maxDate: moment(new Date()).format('YYYY-MM-DD HH:mm'),
            //minDate:'%y-{%M-2}-%d %HH:%mm:%ss',
            onpicked: function (dp) {
                var date = new Date(dp.cal.getNewDateStr());
                that.val(moment(date).format("YYYY-MM-DD HH:mm"));
                if(fn)
                    fn(date);
            }
        },options);
        options.el=id.get(0);
        WdatePicker(options);
    });
}
/**
 * 获取指定时间控件的时间
 * @param id
 * @param format
 * @return {*}
 */
hwc.getDateByTimeBox=function (id,format) {
    var el=_.getJq(id)
    var val=el.val();
    if(format==null){
        format="YYYY-MM-DD HH:mm";
        var prec=el.data("prec");
        if(prec=="H"){
            format="YYYY-MM-DD HH时";
        }
        else if(prec=="D"){
            format="YYYY-MM-DD";
        }
    }
    if(!val)
        return null;
    return moment(val,format).toDate();
}
hwc.jsPrint=function (msgtitle, url, msgcss, callback) {
    var iconurl = "";
    switch (msgcss) {
        case "Success":
            iconurl = "32X32/succ.png";
            break;
        case "Error":
            iconurl = "32X32/fail.png";
            break;
        default:
            iconurl = "32X32/hits.png";
            break;
    }
    $.dialog.setting.zIndex=999999999;
    $.dialog.tips(msgtitle, 2, iconurl);
    return;
    if (url == "back") {
        frames["mainframe"].history.back(-1);
    } else if (url != "") {
        frames["mainframe"].location.href = url;
    }
    //执行回调函数
    if (arguments.length == 4) {
        var func = new Function(callback + "();");
        func();
    }
}
/**
 * 生成li
 * @param data
 * @return {string}
 */
hwc._template={
    li:"<li data-value='{1}'>{0}</li>",
    tr:"<tr>{0}</tr>",
    th:"<th>{0}</th>",
    td:"<td>{0}</td>",
    tdRowspan:"<td rowspan='{0}'>{1}</td>",
    option:"<option value='{value}'>{name}</option>"
}
/**
 *
 * @param data  string|{name,value}
 * @returns {string}
 */
hwc.getOption=function (data) {
    var t=hwc._template.option;
    var s="";
    _.each(data,function (item) {
        if(!_.isObject(item))
            item={value:item,name:item}
        s+=_.strFormat(t,item);
    })
    return s;
}
hwc.getLi=function (data) {
    var t=hwc._template.li;
    var s="";
    data.forEach(function (item) {
        if(!_.isObject(item))
            item={value:item,name:item}
        s+=_.strFormat(t,item.name,item.value);
    })
    return s;
}
hwc.getTh=function(data){
    var t=hwc._template.th;
    var s="";
    _.each(data,function (item) {
        s+=_.strFormat(hwc._template.th,item);
    });
    return _.strFormat(hwc._template.tr,s);
};
/**
 * 生成table body,为_.group的数据结构,支持首列rowspan的合并
 */
hwc.getTd=function (group) {
    var s="";
    _.each(group,function (value,key) {
        var s1="";
        s1+=_.strFormat(hwc._template.tdRowspan,value.length,key);
        _.each(value,function (item) {
            _.each(item,function (item1) {
                s1+=_.strFormat(hwc._template.td,item1);
            })
            s+=_.strFormat(hwc._template.tr,s1);
            s1="";
        });
    })
    return s;
}
/**
 * 生成table body
 * @param data  array
 * @return {string}
 */
hwc.getTdByArray=function (data) {
    var s="";
    _.each(data,function (item) {
        var s1="";
        _.each(item,function (item1) {
            s1+=_.strFormat(hwc._template.td,item1);
        })
        s+=_.strFormat(hwc._template.tr,s1);
    });
    return s;
}
/**
 * 导出excel
 */
hwc.excelExport =function(id) {
    var jq=_.getJq(id);
    var time =  moment().format("YYYY_MM_DD HH_mm_ss");
    jq.table2excel({
        exclude: ".noExl",
        name: "Excel Document Name.xlsx",
        filename: time + ".xls"
    });
}
/**
 * 创建复制按钮
 * @param id
 */
hwc.createCopyBtn=function(id) {
    var clipboard = new Clipboard("#"+id);
    clipboard.on('success', function(e) {
        e.clearSelection();
    });
    clipboard.on('error', function(e) {
        console.error('Action:', e.action);
        console.error('Trigger:', e.trigger);
    });
}

/**
 * jq 的ajax管理
 * ---------------------------------------------------------
 */
hwc._ajaxs={};
/**
 * 添加ajax
 * @param ajax
 * @param type
 */
hwc.pushAjax=function (ajax,type) {
    if(hwc._ajaxs[type]==null)
        hwc._ajaxs[type]=[];
    hwc._ajaxs[type].push(ajax);
}
/**
 * 清理ajax
 * @param type
 */
hwc.clearAjaxs=function (type) {
    if(hwc._ajaxs[type])
        hwc.clearAjax(hwc._ajaxs[type]);
    hwc._ajaxs[type]=[];
}
/**
 * 停止指定的ajax集合
 * @param data
 */
hwc.clearAjax=function (data) {
    if(data==null)
        return;
    if(!_.isArray(data))
        data=[data];
    data.forEach(function (item) {
        if(item&&item.abort)
            item.abort();
    })
}
/**
 * 快速调用ajax
 * @param options
 * @return {*}
 */
hwc.getJson=function (options) {
    options = _.extend({
        type:"POST",
        contentType: 'application/x-www-form-urlencoded;charset=utf-8',//'application/json;charset=utf-8',
        dataType : 'json',
        async: true,
        error: function (err, err1, err2) {
            console.log("调用方法发生异常:" + JSON.stringify(err) + "err1" + JSON.stringify(err1) + "err2:" + JSON.stringify(err2));
        }
    }, options);
    return $.ajax(options);
}
/**
 * 向服务端传递map
 * @param options
 * @return {*}
 */
hwc.ajaxMap=function (options) {
    options=_.extend({
        contentType: 'application/json;charset=utf-8',
    },options);
    if(options.data!=null)
        options.data=JSON.stringify(options.data);
    return hwc.getJson(options);
}

/**
 * jq的ajax转promise
 * @param ajax
 * @return {Promise}
 */
hwc.jqAjaxToPromise=function ({ajax}) {
   var p= new Promise((resolve, reject)=>{
       $.when(ajax).done(function (data) {
           resolve(data)
       }).fail(function () {
           reject()
       })
    })
    return p;
}


/**
 * map操作
 * ---------------------------------------------------------
 */
/**
 * 设置图层显隐
 * @param layer
 * @param visible
 * @param map
 */
hwc.setLayerVisible=function (layer,visible,map) {
    if(!map){
        map=hwc.map;
    }
    if(!map){
        console.warn("没有设定map对象");
        return;
    }

    if(_.isArray(layer)){
        _.each(layer,function (item) {
            hwc.setLayerVisible(item,visible,map);
        })
        return;
    }

    if(!layer)
        return;

    if(visible&&!map.hasLayer(layer))
        map.addLayer(layer);
    else if(!visible&&map.hasLayer(layer))
        map.removeLayer(layer);
}

/**
 * 指定top值的marker点变红色
 * 仅支持 zrender图层
 * @param player
 * @param topVal  指定的top值，如3,5,7,9
 * @param valueColor
 * @param topColor
 *  @param forceShow  是否强行显示
 */
hwc.setTopByLayer=function (player,topVal,topColor,forceShow) {
    if(_.isUndefined(topColor))
        topColor="#ff0000";
    topVal=parseInt(topVal);
    var data=player.data;
    var valueField=player.options.iconOptions.valueField;
    var valueColor=player.options.iconOptions.value_color;
    var result=[];
    if(topVal!=-1){
        data=_.sortBy(data,function (item) {
            return -1*item[valueField];
        });
        var topNum=0;
        for(var i=0;i<data.length;i++)
        {
            if(result.length==0||data[i][valueField]!=result[result.length-1][valueField]){
                if(topNum==topVal)
                    break;
                result.push(data[i]);
                topNum++;
            }
            else{
                result.push(data[i]);
            }
        }
        result=_.pluck(result,"STATIONCODE");
    }
    player.eachLayer(function (layer) {
        if(result.indexOf(layer.data.STATIONCODE)!=-1){
            layer.resetStyle("value",{value_color:topColor});
            if(forceShow){
                layer.add();
                layer.setIsExMarker(true);
            }
        }
        else{
            layer.resetStyle("value",{value_color:valueColor});
            if(forceShow){
                if(layer.options.isExMarker){

                }
                layer.setIsExMarker(false);
                player._onMarkerShowHide(layer);
            }
        }
    })
};

/**
 * 地图数据操作
 * ---------------------------------------------------------
*/
/* 在市县关系文件中通过areacode查找name
 * @param data
 * @param code
 */
hwc.findNameInRelevationByAreaCode=function (data,code,level) {
    var name=null;
    if(level=="city"){
        var item=_.find(data,function (entry) {
            return entry.areacode==code;
        })
        if(item){
            name={"city":item.name,county:""}
        }
    }
    else if(level="county"){
        for(var i=0;i<data.length;i++)
        {
            var item=_.find(data[i].children,function (entry) {
                return entry.areacode==code;
            })
            if(item){
                name={"city":item.city,county:item.name};
            }
            break;
        }
    }
    return name;
}
/**
 * 获取区域名称(没有市、县、区)
 * @param name
 * @return {*}
 */
hwc.getPureAreaName=function(name) {
    if(!name||name.length<2)
        return "";
    var suffix = name.substr(name.length - 1, 1);
    var suffix2 = name.substr(name.length-2,2);
    if(suffix2 == "市区"){
        return name.substring(0, name.length - 2);
    }else if ((suffix == "市" || suffix == "县" || suffix == "区")&&name.length>2) {
        return name.substring(0, name.length - 1);
    }
    return name;
}
/**
 * 比对地图边界名称
 * @param name
 * @param propertiesName
 * @param level
 * @returns {boolean}
 */
hwc.comparisonMapBoundName=function (name,propertiesName,level) {
    if(_.isArray(name))
        return name.indexOf(propertiesName)!=-1;
    return name==propertiesName;
}
/**
 *
 * 获取指定地图等级与名称的geojson数据
 * @param data
 * @param level
 * @param name
 * @param options   {city:}
 * @returns {}
 */
hwc.getGeoJson=function (data,level,name,options,comparisonFun) {
    if(!data)
        return null;
    if(!comparisonFun)
        comparisonFun=hwc.comparisonMapBoundName;
    if(level=="prov"&&!name){
        return data;
    }
    if(level=="county"&&options){
        data=_.find(data.features,function (item) {
            return comparisonFun(options.city,item.properties.city)&&comparisonFun(name,item.properties.name||item.properties.NAME,level);
        })
    }
    else{
        data=_.find(data.features,function (item) {
            return comparisonFun(name,item.properties.name||item.properties.NAME,level);
        })
    }
    data=data||[];
    return {"type":"FeatureCollection","features":[data]};
}

/**
 * 获取目标等级与获取等级不同的geoJson数据  (例如在市级数据上取县界)
 * @param level
 * @param targetLevel
 * @param name
 * @private
 */
hwc.getGeoJsonByDifLvl=function(data,level,targetLevel,name,comparisonFun) {
    if(level==targetLevel)
        return hwc.getGeoJson(data,level,name,null,comparisonFun);
    if(!comparisonFun)
        comparisonFun=hwc.comparisonMapBoundName;
    var isNull=false;
    if(level=="prov"){
        if(data)
            return data;
    }
    else if(level=="city"){
        if(targetLevel=="prov")
            isNull=true;
    }
    else if(level=="county"){
        if(targetLevel=="city"||targetLevel=="prov")
            isNull=true;
    }

    if(!isNull&&data){
        data=_.filter(data.features,function (item) {
            return comparisonFun(name,item.properties[level]);
        })
    }
    else{
        data=null;
    }
    data=data||[];
    return {"type":"FeatureCollection","features":data};
}


/**
 * 获取地图名称数据(市名、县名、镇名)
 * @param data
 * @param level
 * @param targetLevel
 * @param name
 * @returns {*}
 */
hwc.getMapNameData=function (data,level,targetLevel,name,comparisonFun) {
    if(!comparisonFun)
        comparisonFun=hwc.comparisonMapBoundName;
    if(level=="city"){
        if(targetLevel=="prov")
            data=[];
        else if(targetLevel=="city"){
            data=_.filter(data,function (item) {
                return comparisonFun(name,item.name,"city");
            });
        }
        else{
            data=_.filter(data,function (item) {
                return comparisonFun(name,item.city,"city");
            });
        }
    }
    else if(level=="county"){
        if(targetLevel=="prov"||targetLevel=="city")
            data=[];
        else if(targetLevel=="county"){
            data=_.filter(data,function (item) {
                return comparisonFun(name,item.name,"county");
            });
        }
        else{
            data=_.filter(data,function (item) {
                return comparisonFun(name,item.county,"county");
            });
        }
    }
    return data;
}


/**
 * 气象业务数据操作
 * ---------------------------------------------------------
 **/
//根据天气编码获取对应中文名称
hwc.getWeatherDesc = function(num) {
    if(null==num){
        num = "9999";
    }
    num = num.toString();
    var desc = "";
    switch (num) {
        case "0":
            desc = "晴";
            break;
        case "1":
            desc = "多云";
            break;
        case "2":
            desc = "阴";
            break;
        case "3":
            desc = "阵雨";
            break;
        case "4":
            desc = "雷阵雨";
            break;
        case "5":
            desc = "雷阵雨冰雹";
            break;
        case "6":
            desc = "雨夹雪";
            break;
        case "7":
            desc = "小雨";
            break;
        case "8":
            desc = "中雨";
            break;
        case "9":
            desc = "大雨";
            break;
        case "10":
            desc = "暴雨";
            break;
        case "11":
            desc = "大暴雨";
            break;
        case "12":
            desc = "特大暴雨";
            break;
        case "13":
            desc = "阵雪";
            break;
        case "14":
            desc = "小雪";
            break;
        case "15":
            desc = "中雪";
            break;
        case "16":
            desc = "大雪";
            break;
        case "17":
            desc = "暴雪";
            break;
        case "18":
            desc = "雾";
            break;
        case "19":
            desc = "冻雨";
            break;
        case "20":
            desc = "沙尘暴";
            break;
        case "21":
            desc = "小雨-中雨";
            break;
        case "22":
            desc = "中雨-大雨";
            break;
        case "23":
            desc = "大雨-暴雨";
            break;
        case "24":
            desc = "暴雨-大暴雨";
            break;
        case "25":
            desc = "大暴雨-特大暴雨";
            break;
        case "26":
            desc = "小雪-中雪";
            break;
        case "27":
            desc = "中雪-大雪";
            break;
        case "28":
            desc = "大雪-暴雪";
            break;
        case "29":
            desc = "浮尘";
            break;
        case "30":
            desc = "扬沙";
            break;
        case "31":
            desc = "强沙尘暴";
            break;
        case "32":
            desc = "雨";
            break;
        case "33":
            desc = "雾";
            break;
        case "53":
            desc = "霾";
            break;
        default:
            desc = "NULL";
            break;
    }
    return desc;
};

hwc._disasterType=[{field:"HAIL",name:"冰雹"},{filed:"THUNDERSTORM",name:"雷电"},{field:"FOG",name:"雾"},
    {field:"DUST",name:"沙尘暴"},{field:"WIND",name:"大风"},{field:"RAIN",name:"短时强降水"},{field:"RAINSTORM",name:"暴雨"},
    {field:"AIRTEMPMAX",name:"高温"},{field:"AIRTEMPMIN",name:"寒潮"}];
/**
 * 同类型灾害等级比较
 * @param a
 * @param b
 * @private
 */
hwc._compareDisaster=function (a,b) {
    var a1=hwc.parsetDisasterType(a);
    var b1=hwc.parsetDisasterType(b);
    if(a1[1].min<b1[1].min){
        return b;
    }
    else{
        return a;
    }
}
/**
 * 获取灾害详细描述
 * @param data
 * @param type
 */
hwc.getDisasterDetailDesc=function (data,type) {
    var s="";
    if(type=="HAIL"||type=="FOG"||type=="DUST"||type=="WIND"){
        _.each(data,function (item) {
            s+=moment(item.HAPPENTIME).format("YYYY-MM-DD HH:mm")+" "+hwc.ws_getDisasterDesc(item,";")+"<br>";
        })
    }
    else if(type=="RAIN"){
        _.each(data,function (item) {
            s+=moment(item["WS_RAIN_SHORTMAX_ENDTIME"]).format("YYYY-MM-DD HH:mm")+"降水为"+item["WS_RAIN_SHORTMAX_VALUE"]+"mm;<br>";
        })
    }
    else if(type=="RAINSTORM"){
        _.each(data,function (item) {
            s+=moment(item["WS_RAIN_STORM_BEGINTIME"]).format("YYYY-MM-DD HH:mm")+"至"+moment(item["WS_RAIN_STORM_ENDTIME"]).format("YYYY-MM-DD HH:mm")+"降水为"+item["WS_RAIN_STORM_VALUE"]+"mm;<br>";
        })
    }
    else if(type=="AIRTEMPMAX"){
        _.each(data,function (item) {
            s+=moment(item["WS_AIRTEMP_HOT_TIME"]).format("YYYY-MM-DD HH:mm")+"出现日最高气温为"+item["WS_AIRTEMP_HOT_VALUE"]+"℃;<br>";
        })
    }
    else if(type=="AIRTEMPMIN"){
        _.each(data,function (item) {
            s+=moment(item["WS_AIRTEMP_CLOD_BEGINTIME"]).format("YYYY-MM-DD HH:mm")+"至"+moment(item["WS_AIRTEMP_CLOD_ENDTIME"]).format("YYYY-MM-DD HH:mm")+"降温幅度为"+(item["WS_AIRTEMP_CLOD_VALUE_PRE"]-item["WS_AIRTEMP_CLOD_VALUE"])+"℃;<br>";
        })
    }
    return s;
}
/**
 * 解析灾害类型
 * @param data
 * @returns {*[]}
 * @private
 */
hwc.parsetDisasterType=function (data) {
    if(data.indexOf("RAIN_")!=-1||data.indexOf("WIND_")!=-1){
        data=data.split("_");
        var value=data[1];
        data=data[0];
        if(value.indexOf("H")!=-1){
            value={min:Number(value.replace("H","")),max:NaN};
        }
        else{
            value={min:Number(value.substr(0,2)),max:Number(value.substr(value.length-2,2))};
        }
        return [data,value];
    }
    else{
        var indexOf=_.findIndex(hwc._disasterType,function (type) {
            return type.field==data;
        })
        return indexOf!=-1?[data]:null;
    }
}
/**
 * 获取灾害名称
 * @param field
 */
hwc.getDisasterNameByField=function (field) {
    var t=hwc.parsetDisasterType(field);
    if(t==null)
        return "";
    var type=_.find(hwc._disasterType,function (item) {
        return item.field==t[0];
    })
    type=type?type.name:"";
    if(t[1]){
        t[1].equalMin=true;
        t[1].equalMax=true;
        type=hwc.getFilterDesc(t[1])+type;
    }
    return type;
}
/**
 * 解析灾害统计
 * @param data
 * @returns {{}}
 */
hwc.parseDisasterStatistics=function (data) {
    var statistics={};
    _.each(data,function (item) {
        _.each(item,function (value,key) {
            var tempType = hwc.parsetDisasterType(key);
            if (tempType != null) {
                var k = tempType[0];
                //总体统计
                if (value) {
                    if (statistics[k] == null)
                        statistics[k] = 0;
                    statistics[k] += value;
                }
            }
        })
    })
    return statistics;
}
/**
 * 解析灾害
 * @param data
 * @param beginTime
 * @param endTime
 * @returns
 */
hwc.parseDisaster=function (data,beginTime,endTime) {
    _.each(data,function (item) {
        item.beginTime=beginTime;
        item.endTime=endTime;
        var wsType=[];
        _.each(item,function (value,key) {
            var tempType= hwc.parsetDisasterType(key);
            if(tempType!=null){
                var k=tempType[0];
                //获取类型
                //一般类型
                if(k==key){
                    if(value)
                        wsType.push(k)
                }
                //雨、风取大的做为类型
                else {
                    if(value){
                        var type=_.find(wsType,function (t) {
                            return t.indexOf(k+"_")!=-1;
                        })
                        if(type){
                            var t=hwc._compareDisaster(type,key);
                            if(t!=type){
                                wsType=_.filter(wsType,function (wt) {
                                    return wt!=type;
                                })
                                wsType.push(t);
                            }
                        }
                        else{
                            wsType.push(key);
                        }
                    }
                }
            }
        })
        item.wsType=wsType;
        item.disCount=wsType.length;
    })
    return data;
}
/**
 * 获取天气要素的有效值（带单位）
 * @param value
 * @param type
 * @return {string}
 */
hwc.getWeatherVal=function(value,type){
    if(type=="temp")
        return hwc.isVoid(value)?"":value+"℃";
    else if(type=="rain")
        return hwc.isVoid(value)?"":value+"mm";
    else if(type=="wind")
        return hwc.isVoid(value)||hwc.isVoid(value[0])||hwc.isVoid(value[1])?"":value[1]+"m/s "+hwc.getWindDirection(value[0],value[1]);
    else if(type=="rh")
        return hwc.isVoid(value)?"":value+"%";
    else if(type=="visible")
        return hwc.isVoid(value)?"":value+"km";
    else if(type=="pressure")
        return hwc.isVoid(value)?"":value+"hpa";
}
//计算风向
hwc.getWindDirection = function (dir, speed) {
    var retString = "";
    if (speed == 0) {
        retString = "静风";
    }
    else {
        var grade = 0;
        var val = parseFloat(dir) + 11.25;
        if (val < 360) {
            grade = parseInt(Math.floor(val / 22.5));
        }
        else {
            grade = 0;
        }
        switch (grade) {
            case 0:
                retString = "北";
                break;
            case 1:
                retString = "东北偏北";
                break;
            case 2:
                retString = "东北";
                break;
            case 3:
                retString = "东北偏东";
                break;
            case 4:
                retString = "东";
                break;
            case 5:
                retString = "东南偏东";
                break;
            case 6:
                retString = "东南";
                break;
            case 7:
                retString = "东南偏南";
                break;
            case 8:
                retString = "南";
                break;
            case 9:
                retString = "西南偏南";
                break;
            case 10:
                retString = "西南";
                break;
            case 11:
                retString = "西南偏西";
                break;
            case 12:
                retString = "西";
                break;
            case 13:
                retString = "西北偏西";
                break;
            case 14:
                retString = "西北";
                break;
            case 15:
                retString = "西北偏北";
                break;
        }
    }
    return retString;
};
/**
 * 合并危险天气与短强
 * @param data
 * @param shortData
 * @param legendData
 */
hwc.ws_getMergeShortData=function (data,shortData,legendData) {
    var newData=[];
    _.each(shortData,function (item) {
        var index=_.findIndex(legendData,function (legendItem) {
            return hwc.isFilter(item.RAIN_SUM_VALUE,legendItem);
        })
        if(index!=-1){
            var wsItem=_.find(data,function (wsItem) {
                return wsItem.STATIONCODE==item.STATIONCODE;
            })
            if(wsItem)
                wsItem.shortStrength=item.RAIN_SUM_VALUE;
            else{
                item=_.clone(item);
                item.shortStrength=item.RAIN_SUM_VALUE;
                item.HAPPENTIME=item.RAIN_SUM_ENDTIME;
                newData.push(item);
            }
        }
    })
    data=data.concat(newData);
    return data;
}
/**
 *返回危险天气的类型
 * @param source
 * @return
 *
 */
hwc.ws_getWsType=function(source,windLegend){
    var type=[];

    if((!hwc.isVoid(source["RAIN_1"])&&source["RAIN_1"]!=0)||(!hwc.isVoid(source["RAIN_3"])&&source["RAIN_3"]!=0) ||(!hwc.isVoid(source["RAIN_6"])&&source["RAIN_6"]!=0)
        || (!hwc.isVoid(source["RAIN_24"])&&source["RAIN_24"]!=0)||(!hwc.isVoid(source["RAIN_DAY"])&&source["RAIN_DAY"]!=0)){
        type.push("降水");
    }

    if (!hwc.isVoid(source["WINDSPEED_CURRENT"])&&source["WINDSPEED_CURRENT"]!=0){
        if(windLegend){
            var ll=hwc.getLegendItem(windLegend,source["WINDSPEED_CURRENT"]);
            if(ll)
                type.push("大风"+ll.desc);
            else
                type.push("大风"+windLegend[0].desc);
        }
        else{
            type.push("大风");
        }
    }

    if(!hwc.isVoid(source["TORNADO"])&&source["TORNADO"]!=-1) {
        type.push("龙卷");
    }

    if (!hwc.isVoid(source["HAIL_DIAMETER"])&&source["HAIL_DIAMETER"]!=0){
        type.push("冰雹");
    }

    if (!hwc.isVoid(source["ISTHUNDERSTORM"])&&source["ISTHUNDERSTORM"]!=0) {
        type.push("雷暴");
    }

    if (!hwc.isVoid(source["FOG"])&&source["FOG"]!=0) {
        if(source["FOG"]==5)
            type.push("霾");
        else
            type.push("雾");
    }
    if (!hwc.isVoid(source["SNOW_DEPTH"])&&source["SNOW_DEPTH"]!=0){
        type.push("雪深");
    }
    return type;
}
/**
 *返回指定灾害天气数据的文本描述
 * @param source
 * @param parseMode 解析模式 0传统解析，1完整的天气现象解析
 * @return
 *
 */
hwc.ws_getDisasterDesc=function(source,division,parseMode) {
    var text=[];
    division=division||"<br>";
    if (!hwc.isVoid(source["WINDSPEED_CURRENT"])&&source["WINDSPEED_CURRENT"]!=0){
        text.push('1小时极大风速'+source["WINDSPEED_CURRENT"] + "m/s");
    }
    if (!hwc.isVoid(source["HAIL_DIAMETER"])&&source["HAIL_DIAMETER"]!=0){
        text.push('冰雹直径'+source["HAIL_DIAMETER"]/10 + "cm");
    }
    if (!hwc.isVoid(source["ISTHUNDERSTORM"])&&source["ISTHUNDERSTORM"]!=0) {
        text.push("有雷暴现象");
    }
    if (!hwc.isVoid(source["VISIBILITY"])&&source["VISIBILITY"]!=0) {
        text.push('能见度'+source["VISIBILITY"] + "m");
    }
    if (!hwc.isVoid(source["FOG"])&&source["FOG"]!=0){
        text.push(parseMode==1?this.getWsFogByCode(source["FOG"]):this.getWsFogByCode1(source["FOG"]));
    }
    if (!hwc.isVoid(source["DUST"])&&source["DUST"]!=0){
        text.push(parseMode==1?this.getWsFogByCode(source["DUST"]):this.getWsFogByCode1(source["DUST"]));
    }
    return text.join(division);
}
/**
 *返回指定危险数据的文本描述
 * @param source
 * @param parseMode 解析模式 1传统解析，其他完整的天气现象解析
 * @return
 *
 */
hwc.ws_getWsDesc=function(source,parseMode) {
    var text="";
    if (!hwc.isVoid(source["shortStrength"])) {
        text+='短时强降水:'+source["shortStrength"]+"mm\n";
    }
    if (!hwc.isVoid(source["RAIN_1"])&&source["RAIN_1"]!=0) {
        text+='过去1小时降水:'+source["RAIN_1"]+"mm\n";
    }
    if (!hwc.isVoid(source["RAIN_3"])&&source["RAIN_3"]!=0) {
        text+='过去3小时降水:'+source["RAIN_3"]+"mm\n";
    }
    if (!hwc.isVoid(source["RAIN_6"])&&source["RAIN_6"]!=0){
        text+='过去6小时降水:'+source["RAIN_6"]+"mm\n";
    }
    if (!hwc.isVoid(source["RAIN_24"])&&source["RAIN_24"]!=0){
        text+='过去24小时降水:'+source["RAIN_1"]+"mm\n";
    }
    if (!hwc.isVoid(source["RAIN_DAY"])&&source["RAIN_DAY"]!=0){
        text+='当日累积降水:'+source["RAIN_DAY"] + "mm\n";
    }
    if (!hwc.isVoid(source["WINDSPEED_CURRENT"])&&source["WINDSPEED_CURRENT"]!=0){
        text+='1小时极大风速:'+source["WINDSPEED_CURRENT"] + "m/s\n";
    }
    if (!hwc.isVoid(source["WINDDIR_CURRENT"])&&source["WINDDIR_CURRENT"]!=0) {
        var dir=this.getFX(source["WINDDIR_CURRENT"],source["WINDSPEED_CURRENT"]);
        text+='1小时极大风向:'+hwc.getFxChinaByEng(dir)+"("+dir+")" +"\n";

    }
    if(!hwc.isVoid(source["TORNADO"])&&source["TORNADO"]!=-1){
        text+='龙卷:'+hwc.getWsTornadoByCode(source["TORNADO"])+"\n";
    }
    if(!hwc.isVoid(source["TORNADO_POSITION"])&&source["TORNADO_POSITION"]!=-1){
        text+='龙卷方位:'+hwc.getWsTornadoPositionByCode(source["TORNADO_POSITION"])+"\n";
    }
    if (!hwc.isVoid(source["SNOW_DEPTH"])&&source["SNOW_DEPTH"]!=0) {
        text+='积雪深度:'+source["SNOW_DEPTH"] + "cm\n";
    }
    if (!hwc.isVoid(source["GLAZE"])&&source["GLAZE"]!=0) {
        text+='雨凇:'+hwc.getWsGlazeByCode(source["GLAZE"])+"\n";
    }
    if (!hwc.isVoid(source["HAIL_DIAMETER"])&&source["HAIL_DIAMETER"]!=0){
        text+='冰雹直径:'+source["HAIL_DIAMETER"]/10 + "cm\n";
    }
    if (!hwc.isVoid(source["ISTHUNDERSTORM"])&&source["ISTHUNDERSTORM"]!=0) {
        text+='雷暴:'+"有雷暴现象\n";
    }
    if (!hwc.isVoid(source["VISIBILITY"])&&source["VISIBILITY"]!=0) {
        text+='能见度:'+source["VISIBILITY"] + "m\n";
    }
    if (!hwc.isVoid(source["FOG"])&&source["FOG"]!=0){
        text+='天气现象:' + parseMode==1?hwc.getWsFogByCode(source["FOG"])+"\n":hwc.getWsFogByCode1(source["FOG"])+"\n";
    }
    return text;
}
/**
 * 获取风向
 * @param	code
 * @return
 */
hwc.getWsWindDirByCode=function(code) {
    var str;
    switch(code){
        case 2:
            str = "NNE";
            break;
        case 4:
            str = "NE";
            break;
        case 7:
            str = "ENE";
            break;
        case 9:
            str = "E";
            break;
        case 11:
            str = "ESE";
            break;
        case 14:
            str = "SE";
            break;
        case 16:
            str = "SSE";
            break;
        case 18:
            str = "S";
            break;
        case 20:
            str = "SSW";
            break;
        case 22:
            str = "SW";
            break;
        case 25:
            str = "WSW";
            break;
        case 27:
            str = "W";
            break;
        case 29:
            str = "WNW";
            break;
        case 32:
            str = "NW";
            break;
        case 34:
            str = "NNW";
            break;
        case 36:
            str = "N";
            break;
    }
    return str;
}
/**
 * 获取雨淞
 * @param	code
 * @return
 */
hwc.getWsGlazeByCode=function(code){
    var str;
    if (code>=4&&code <= 55) str = String(code)+"mm";
    else if (code == 56) str = String(60)+"mm";
    else if (code > 56 && code <= 90) str = String((code - 56) * 10 + 60)+"mm";
    else if (code == 98) str = "超过400mm";
    else if (code == 99) str = "不可能测量";
    return str;
}
/**
 * 获取龙卷信息
 * @param	dm
 * @return
 */
hwc.getWsTornadoByCode=function(code) {
    var str;
    switch(code){
        case 0:
            str = "海龙卷，距测站3千米或以内";
            break;
        case 1:
            str = "海龙卷，距测站3千米以外";
            break;
        case 2:
            str = "陆龙卷，距测站3千米或以内";
            break;
        case 3:
            str = "陆龙卷，距测站3千米以外";
            break;
        case 7:
            str = "轻微强度的尘卷风";
            break;
        case 8:
            str = "中等强度的尘卷风";
            break;
        case 9:
            str = "猛烈强度的尘卷风";
            break;
    }
    return str;
}
/**
 * 获取龙卷方向
 * @param	code
 * @return
 */
hwc.getWsTornadoPositionByCode=function(code){
    var str;
    switch(code){
        case 0:
            str = "在测站上";
            break;
        case 1:
            str = "东北";
            break;
        case 2:
            str = "东";
            break;
        case 3:
            str = "东南";
            break;
        case 4:
            str = "南";
            break;
        case 5:
            str = "西南";
            break;
        case 6:
            str = "西";
            break;
        case 7:
            str = "西北";
            break;
        case 8:
            str = "北";
            break;
        case 9:
            str = "几个方位或不明";
            break;
    }
    return str;
}
/**
 * 获取雾现象
 * @param	code
 * @return
 */
hwc.getWsFogByCode=function(code){
    var str="";
    switch(code)
    {
        case 4:
            str="烟";
            break;
        case 5:
            str="观测时有霾";
            break;
        case 10:
            str = "轻雾";
            break;
        case 11:
            str = "测站有浅雾，呈片状，在陆地上厚度不超过2米，在海上不超过10米";
            break;
        case 12:
            str = "测站有浅雾，基本连续，在陆地上厚度不超过2米，在海上不超过10米";
            break;
        case 40:
            str = "观测时近处有雾，其高度高于观测员的眼睛(水平视线)，但观测前一小时内测站没有雾";
            break;
        case 41:
            str = "散片的雾";
            break;
        case 42:
            str = "雾，过去一小时内已变薄，天空可辨明";
            break;
        case 43:
            str = "雾，过去一小时内已变薄，天空不可辨";
            break;
        case 44:
            str = "雾，过去一小时内强度没有显著的变化，天空可辨明";
            break;
        case 45:
            str = "雾，过去一小时内强度没有显著的变化，天空不可辨";
            break;
        case 46:
            str = "雾，过去一小时内开始出现或已变浓，天空可辨明";
            break;
        case 47:
            str = "雾，过去一小时内开始出现或已变浓，天空不可辨";
            break;
        case 48:
            str = "雾，有雾凇结成，天空可辨明";
            break;
        case 49:
            str = "雾，有雾凇结成，天空不可辨";
            break;
    }
    return str;
}
/**
 * 获取雾现象　新的编码解析
 * @param	code
 * @return
 */
hwc.getWsFogByCode1=function(code){
    var str="";
    switch(code)
    {
        case 1:
            str="云在消失变薄";
            break;
        case 2:
            str="云大致无变化";
            break;
        case 3:
            str="云在发展增厚";
            break;
        case 4:
            str="烟雾、吹烟";
            break;
        case 5:
            str="霾";
            break;
        case 6:
            str="浮尘";
            break;
        case 7:
            str="扬沙";
            break;
        case 8:
            str="尘卷风";
            break;
        case 9:
            str="沙尘暴";
            break;
        case 10:
            str = "轻雾";
            break;
        case 11:
            str = "片状或带状浅雾";
            break;
        case 12:
            str = "层状浅雾";
            break;
        case 13:
            str = "远电、闪电";
            break;
        case 14:
            str = "降水但未及地";
            break;
        case 15:
            str = "降水距本站5km外";
            break;
        case 16:
            str = "降水距本站5km内";
            break;
        case 17:
            str = "闻雷但测站无降水";
            break;
        case 18:
            str = "飑";
            break;
        case 19:
            str = "龙卷";
            break;
        case 20:
            str = "观测前一小时内有毛毛雨";
            break;
        case 21:
            str = "观测前一小时内有雨";
            break;
        case 22:
            str = "观测前一小时内有雪";
            break;
        case 23:
            str = "观测前一小时内有雨夹雪";
            break;
        case 24:
            str = "观测前一小时内有毛毛雨或雨并有雨凇";
            break;
        case 25:
            str = "观测前一小时内有阵雨";
            break;
        case 26:
            str = "观测前一小时内有阵雪";
            break;
        case 27:
            str = "观测前一小时内有冰雹或冰粒或霰";
            break;
        case 28:
            str = "观测前一小时内有雾";
            break;
        case 29:
            str = "观测前一小时内有雷暴";
            break;
        case 30:
            str = "中轻度的沙尘暴过去一小时内减弱";
            break;
        case 31:
            str = "中轻度的沙尘暴";
            break;
        case 32:
            str = "中轻度的沙尘暴过去一小时内加强";
            break;
        case 33:
            str = "强的的沙尘暴过去一小时内加减弱";
            break;
        case 34:
            str = "强的的沙尘暴";
            break;
        case 35:
            str = "强的的沙尘暴过去一小时内加强";
            break;
        case 36:
            str = "中度的低吹雪";
            break;
        case 37:
            str = "强的低吹雪";
            break;
        case 38:
            str = "中轻度的高吹雪";
            break;
        case 39:
            str = "强的高吹雪";
            break;
        case 40:
            str = "近处有雾，但过去1小时内测站没有";
            break;
        case 41:
            str = "散片的雾，呈带状";
            break;
        case 42:
            str = "雾，过去一小时内已变薄，天顶可辨";
            break;
        case 43:
            str = "雾，过去一小时内已变薄，天顶不可辨";
            break;
        case 44:
            str = "雾，过去一小时内无变化，天顶可辨";
            break;
        case 45:
            str = "雾，过去一小时内无变化，天顶不可辨";
            break;
        case 46:
            str = "雾，过去一小时内变浓，天顶可辨";
            break;
        case 47:
            str = "雾，过去一小时内变浓，天顶不可辨";
            break;
        case 48:
            str = "雾，有雾凇结成，天顶可辨";
            break;
        case 49:
            str = "雾，有雾凇结成，天顶不可辨";
            break;
        case 50:
            str = "间歇性轻毛毛雨";
            break;
        case 51:
            str = "连续性轻毛毛雨";
            break;
        case 52:
            str = "间歇性中毛毛雨";
            break;
        case 53:
            str = "连续性中毛毛雨";
            break;
        case 54:
            str = "间歇性浓毛毛雨";
            break;
        case 55:
            str = "连续性浓毛毛雨";
            break;
        case 56:
            str = "轻毛毛雨并有雨淞";
            break;
        case 57:
            str = "中或浓毛毛雨并有雨淞";
            break;
        case 58:
            str = "轻毛毛雨夹雨";
            break;
        case 59:
            str = "中或浓毛毛雨夹雨";
            break;
        case 60:
            str = "间歇性小雨";
            break;
        case 61:
            str = "连续性小雨";
            break;
        case 62:
            str = "间歇性中雨";
            break;
        case 63:
            str = "连续性中雨";
            break;
        case 64:
            str = "间歇性大雨";
            break;
        case 70:
            str = "间歇性小雪";
            break;
        case 71:
            str = "连续性小雪";
            break;
        case 72:
            str = "间歇性中雪";
            break;
        case 73:
            str = "连续性中雪";
            break;
        case 74:
            str = "间歇性大雪";
            break;
        case 75:
            str = "连续性大雪";
            break;
        case 76:
            str = "冰针或伴有雾";
            break;
        case 77:
            str = "米雪或伴有雾";
            break;
        case 78:
            str = "孤立的星状雪晶或伴有雾";
            break;
        case 79:
            str = "冰粒";
            break;
        case 80:
            str = "小阵雨";
            break;
        case 81:
            str = "中常或大阵雨";
            break;
        case 82:
            str = "强阵雨";
            break;
        case 83:
            str = "小的阵雨夹雪";
            break;
        case 84:
            str = "中常或大的阵雨夹雪";
            break;
        case 85:
            str = "小阵雪";
            break;
        case 86:
            str = "中常或大的阵雪";
            break;
        case 87:
            str = "小的阵性霰或小冰雹或有雨或有雨或有雨夹雪";
            break;
        case 88:
            str = "中常或大的阵性霰或小冰雹或有雨或有雨或有雨夹雪";
            break;
        case 89:
            str = "轻的冰雹或有雨或有雨夹雪";
            break;
        case 90:
            str = "中常或大的冰雹或有雨或有雨夹雪";
            break;
        case 91:
            str = "观测前1小时内有雷暴，观测时有小雨";
            break;
        case 92:
            str = "观测前1小时内有雷暴，观测时有中雨";
            break;
        case 93:
            str = "观测前1小时内有雷暴，观测时有小雪";
            break;
        case 94:
            str = "观测前1小时内有雷暴，观测时有中雪";
            break;
        case 95:
            str = "小或中常的雷暴，并有雨或雨夹雪";
            break;
        case 96:
            str = "小或中常的雷暴，并有冰雹或霰";
            break;
        case 97:
            str = "大雷暴，并有雨、或雪或雨夹雪";
            break;
        case 98:
            str = "雷暴伴有沙尘暴";
            break;
        case 99:
            str = "大雷暴，并有冰雹或霰";
            break;
    }
    return str;
}
/**
 * 角度转风向
 * @param	currentWindDirection 当前风向
 * @param	fs  风速
 * @param  china 是否中文
 * @return
 */
hwc.getFX=function(currentWindDirection,fs,china){
    var direction,grade,windir;
    if(fs==0)direction = "C";
    else windir = currentWindDirection + 11.25;
    if(windir > 360)  grade = 0;
    else grade = Math.floor(windir / 22.5);
    if (grade == 0) direction = "N";
    else if (grade == 1) direction = "NNE";
    else if (grade == 2) direction = "NE";
    else if (grade == 3) direction = "ENE";
    else if (grade == 4) direction = "E";
    else if (grade == 5) direction = "ESE";
    else if (grade == 6) direction = "SE";
    else if (grade == 7) direction = "SSE";
    else if (grade == 8) direction = "S";
    else if (grade == 9) direction = "SSW";
    else if (grade == 10)direction = "SW";
    else if (grade == 11)direction = "WSW";
    else if (grade == 12)direction = "W";
    else if (grade == 13)direction = "WNW";
    else if (grade == 14)direction = "NW";
    else if (grade == 15)direction = "NNW";
    return china?hwc.getFxChinaByEng(direction):direction;
}
/**
 * 获取中文风向
 * @param	dm
 * @return
 */
hwc.getFxChinaByEng=function(fx){

    var str;
    switch(fx){
        case 'C':
            str = '静风';
            break;
        case 'NNE':
            str = "北东北";
            break;
        case 'NE':
            str = "东北";
            break;
        case 'ENE':
            str = "东东北";
            break;
        case 'E':
            str = "东";
            break;
        case 'ESE':
            str = "东东南";
            break;
        case 'SE':
            str = "东南";
            break;
        case 'SSE':
            str = "南东南";
            break;
        case 'S':
            str = "南";
            break;
        case 'SSW':
            str = "南西南";
            break;
        case 'SW':
            str = "西南";
            break;
        case 'WSW':
            str = "西西南";
            break;
        case 'W':
            str = "西";
            break;
        case 'WNW':
            str = "西西北";
            break;
        case 'NW':
            str = "西北";
            break;
        case 'NNW':
            str = "北西北";
            break;
        case 'N':
            str = "北";
            break;
    }
    return str;
}
/**
 * 风速转风力
 */
hwc.windSpeedToLevel=function(c){
    var fldj = 0;
    if (c >= 0 && c <= 0.2)
        fldj = 0;
    else if (c > 0.2 && c <= 1.5)
        fldj = 1;
    else if (c > 1.5 && c <= 3.3)
        fldj = 2;
    else if (c > 3.3 && c <= 5.4)
        fldj = 3;
    else if (c > 5.4 && c <= 7.9)
        fldj = 4;
    else if (c > 7.9 && c <= 10.7)
        fldj = 5;
    else if (c > 10.7 && c <= 13.8)
        fldj = 6;
    else if (c > 13.8 && c <= 17.1)
        fldj = 7;
    else if (c > 17.1 && c <= 20.7)
        fldj = 8;
    else if (c > 20.7 && c <= 24.4)
        fldj = 9;
    else if (c > 24.4 && c <= 28.4)
        fldj = 10;
    else if (c > 28.4 && c <= 32.6)
        fldj = 11;
    else if (c > 32.6 && c <= 36.9)
        fldj = 12;
    else if (c > 36.9 && c <= 41.4)
        fldj = 13;
    else if (c > 41.4 && c <= 46.1)
        fldj = 14;
    else if (c > 46.1 && c <= 50.9)
        fldj = 15;
    else if (c > 50.9 && c <= 56)
        fldj = 16;
    else if (c > 56 && c <= 61.2)
        fldj = 17;
    else if (c > 61.2)
        fldj = 18;
    return fldj;
}
/**
 * 解析7天精细化
 * @param data
 * @param interval  返回结果中的间隔时间
 */
hwc.parseSwp7ToArray=function (data,interval) {
    var result=[];
    interval=interval||24;
    _.each(data,function (value) {
        for(var i=0;i<168/interval;i++)
        {
            result.push({name:value.STATIONNAME,code:value.STATIONCODE,
                forecastTime:moment(value.PREDICTIONTIME).add(i*interval,"h").toDate(),
                lowTemper:value["TEMPERATURE"+(i+1)*interval+"_LOW"],
                highTemper:value["TEMPERATURE"+(i+1)*interval+"_HIGH"],
                weatherDesc:value["WEATHERDESC"+(i+1)*interval],
                windSpeed:value["WINDSPEEDDESC"+(i+1)*interval],
                windDir:value["WINDDIRDESC"+(i+1)*interval]})
        }
    })
    return result;
}
/**
 * 解析站点预报数据至array结构
 * @param data
 */
hwc.parseStatForcastDataToArray=function (data,interval) {
    var result=[];
    var flog=false;
    if(interval>=12){
        flog=true;
    }
    _.each(data,function (value,key) {
        _.each(value,function (value1,index) {
            if(!result[index])
                result[index]={};
            result[index][key]=value1.text=='999.9'?"":value1.text;
            if(key=="forecastTime"||key=="forecasttime"){
                result[index][key]=result[index][key]?moment(result[index][key],"YYYY/MM/DD hh:mm:ss").toDate():null;
                if(flog&&result[index][key])
                    result[index][key]=moment(result[index][key]).add(-1*interval,"h").toDate();
            }

            else if(key=="heighttemper")
                result[index]["hightemper"]=result[index][key];
        })
    })
    return result;
}
/**
 * 量级统计
 * @param data
 * @param legendData
 */
hwc.statisticsMagnitude=function (data,field,legendData) {
    var result={};
    _.each(data,function (item) {
        var ldItem=_.find(legendData,function (ldItem) {
            return hwc.isFilter(item[field],ldItem)
        });
        if(ldItem){
            var key=ldItem.desc||hwc.getFilterDesc(ldItem);
            if(!result[key])
                result[key]=[];
            result[key].push(item);
        }
    })
    result=_.map(result,function (value,key) {
        return {key:key,value:value}
    })

    result=_.sortBy(result,function (item) {
        return -1*_.findIndex(legendData,function (ldItem) {
                return ldItem.desc==item.key;
            })
    })

    return result;

}

/**
 * 解析武汉暴雨所的风暴结构
 * @param data
 */
hwc.parseDisReco1=(data)=>{
   var result=[];
   _.each(data,item=>{
       result.push({
           ...item,
           typecode:"风暴",
           lat:item.RZA_FSTORMLAT,
           lon:item.RZA_FSTORMLON,
           name:item.RZA_STORMID
       });
       if(item.RZA_FLAGMESO){
           result.push({
               ...item,
               typecode:"中气旋",
               lat:item.RZA_FMESOLAT,
               lon:item.RZA_FMESOLON,
               name:""
           });
       }
       if(item.RZA_FGALELON&&item.RZA_FGALELAT){
           result.push({
               ...item,
               typecode:"大风",
               lat:item.RZA_FGALELAT,
               lon:item.RZA_FGALELON,
               name:""
           });
       }
   })
    return result;
}
/**
 * 解析灾害识别
 * @param data
 * @return {Array}
 */
hwc.parseDisReco=function (data) {
    var result=[];
    _.each(data.Products,function (item) {
        if(!item)
            return;
        var typecode=item.typeCode;
        _.each(item.datas,function (item1) {
            result.push({
                typecode:typecode,
                lat:item1.Lat,
                lon:item1.Lon,
                name:item1.StormId
            })
        })
    })
    return result;
}



/**
 * 任意点描述
 */
hwc.getJxhAnyPointDesc=(data,field)=> {
    var desc="";
    var f=field+"desc";
    if(field.indexOf("wp")!=-1){
        if(data["wp"]!=null)
            desc=hwc.getWeatherDesc(data["wp"]);
        else if(data["wp1"]!=null&&data["wp2"]!=null){
            if(data["wp1"]==data["wp2"]){
                desc=hwc.getWeatherDesc(data["wp1"]);
            }
            else {
                desc=hwc.getWeatherDesc(data["wp1"])+"转"+hwc.getWeatherDesc(data["wp2"]);
            }
        }
        f="wpdesc";
    }
    else if(field.indexOf("rh2m")!=-1||field.indexOf("vis")!=-1||field.indexOf("vis")!=-1||field.indexOf("tcc")!=-1){
        if(data[field]!=null)
            desc=data[field];
        else if(data[field+"max"]!=null||data[field+"min"]!=null)
            desc=data[field+"min"]+"~"+data[field+"max"];
        f=field.replace("min","").replace("max","")+"desc";
    }
    else if(field=="10uv_speed"){
        desc=hwc.windSpeedToLevel(data[field]);
    }
    else if(field=="10uv_dir")
    //desc=hwc.getFX(data[field],data["10uv_speed"],true);
        desc=hwc.getWindDirection(data[field],data["10uv_speed"]);
    else{
        if(data[field]!=null)
            desc=data[field];
    }
    return [desc,f];
}
/**
 * 解析多点任意点预报
 * @param data
 * @param markers [{lat,lng},...]
 * @param interhour
 * @return {*}
 */
hwc.parseJxhAnyPoint=(data,{markers,interhour})=>{
    _.each(data,function (item) {
        var producttime=moment(item.producttime);
        var marker=_.find(markers,function (m) {
            return m.lat==Number(item.lat)&&m.lon==Number(item.lon);
        });
        var arr=[];
        _.each(item.elementlist,function (elist) {
            var o={};
            _.each(elist.elementname,function (n,index) {
                if(interhour!=1||n=="rain1")
                    n=n.replace(String(interhour),"");
                o[n]=elist.elementvalue[index];
                if(o[n]=='999.9'||o[n]=="")
                    o[n]=null;
                if(o[n]!=null)
                    o[n]=Number(o[n]);

                if(n.indexOf("wp")!=-1){
                    o[n+"desc1"]=hwc.getWeatherDesc(o[n]);
                }
            })
            if(o["t2m"]||(o["tmin"]&&o["tmax"]))
                o["tdesc1"]=o["t2m"]?o["t2m"]+"℃":o["tmin"]+"/"+o["tmax"]+"℃";

            _.each(elist.elementname,function (n,index) {
                if(interhour!=1||n=="rain1"){
                    n=n.replace(String(interhour),"");
                }
                var desc=hwc.getJxhAnyPointDesc(o,n);
                o[desc[1]]=desc[0];
            })

            o["uvSpeed"]=o["10uv_speed"];
            o["uvSpeeddesc"]=o["10uv_speeddesc"];
            o["uvDirdesc"]=o["10uv_dirdesc"];

            o.timesession=Number(elist.timesession);
            o.happenTime=moment(producttime).add(o.timesession,"h").format("YYYY-MM-DD HH:mm:ss");
            o.happenTimedesc=interhour==24?moment(o.happenTime).format("DD日"):moment(o.happenTime).format("DD日HH时")
            arr.push(o);
        });
        _.sortBy(arr,function (item) {
            return Number(item.timesession);
        })
        if(marker){
            marker.producttime=item.producttime;
            marker.elementlist=arr;
        }
    })
    return markers;
}

/**
 * 常用工具操作
 * ---------------------------------------------------------
 */

hwc.strFormat = function (str,args) {
    var result = str;
    if (arguments.length > 1) {
        if (arguments.length == 2 && typeof (args) == "object") {
            if(_.isArray(args)){
                for(var i=0;i<args.length;i++)
                {
                    if (args[i]== null) {
                        args[i]="";
                    }
                    var reg = new RegExp("(\\{" + i + "\\})", "g");
                    result = result.replace(reg, args[i]);
                }
            }
            else{
                for (var key in args) {
                    if (args[key] == null) {
                        args[key]="";
                    }
                    var reg = new RegExp("({" + key + "})", "g");
                    result = result.replace(reg, args[key]);
                }
            }
        }
        else {
            for (var i = 1; i < arguments.length; i++) {
                if (arguments[i] == null) {
                    arguments[i]="";
                }
                var reg = new RegExp("({)" + (i-1) + "(})", "g");
                result = result.replace(reg, arguments[i]);
            }
        }
    }
    return result;
};
hwc.replaceAll=function(str,searchValue,replaceValue){
    return str.replace(new RegExp(searchValue,'gm'),replaceValue);
}
/**
 * 首字母大写
 */
hwc.ucfirst=function(data) {
    if(_.isObject(data)){
        var result=_.isArray(data)?[]:{};
        _.each(data,function (value,key) {
            if(_.isObject(value))
                result[hwc.ucfirst(key)]=hwc.ucfirst(value);
            else {
                if (_.isNumber(key)) {
                    result[key] = value;
                }
                else {
                    result[hwc.ucfirst(key)] = value;
                }
            }
        })
        return result;
    }
    else if(_.isString(data)){
        var str = data.toLowerCase();
        str = str.replace(/\b\w+\b/g, function(word){
            return word.substring(0,1).toUpperCase()+word.substring(1);
        });
        return str;
    }
};
/**
 * 字段转换为小写
 * @param data
 * @return {*}
 */
hwc.toLowerCase=function (data) {
    if(_.isObject(data)){
        var result=_.isArray(data)?[]:{};
        _.each(data,function (value,key) {
            if(_.isObject(value)&&!(value instanceof Date)){
                if(_.isNumber(key)){
                    result[key]=hwc.toLowerCase(value);
                }
                else
                    result[hwc.toLowerCase(key)]=hwc.toLowerCase(value);
            }
            else {
                if (_.isNumber(key)) {
                    result[key] = value;
                }
                else {
                    result[hwc.toLowerCase(key)] = value;
                }
            }
        })
        return result;
    }
    else if(_.isString(data)){
        var str = data.toLowerCase();
        return str;
    }
}
hwc.isVoid=function (data) {
    return _.isNull(data)||_.isUndefined(data)||_.isNaN(data);
}
hwc.line2camel=function (value) {
    return value.replace(/_(\w)/g, function(all, letter){
        return letter.toUpperCase();
    })
}
hwc.test=function (desc,time) {
    var now=new Date();
    console.info(desc+":"+(now.getTime()-time.getTime())/1000+"s")
    return now;
}

/**
 * 返回指定字段的最大值对象
 * @param data
 * @param field
 * @return {*}
 */
hwc.getMaxObj=({data,field})=>{
    var max=null;
    var o;
    _.each(data,item=>{
        if(max==null){
            max=item[field];
            o=item;
        }
        if(item[field]!=null&&item[field]>max){
            max=item[field];
            o=item;
        }
    })
    return o;
}

/**
 * 返回指定字段的最小值对象
 * @param data
 * @param field
 * @return {*}
 */
hwc.getMinObj=({data,field})=>{
    var min=null;
    var o;
    _.each(data,item=>{
        if(min==null){
            min=item[field];
            o=item;
        }
        if(item[field]!=null&&item[field]<min){
            min=item[field];
            o=item;
        }
    })
    return o;
}


/**
 * 系统应用
 * ---------------------------------------------------------
 */
hwc.addCss=function (pluginName,cssName) {
    var url= "";
    if(_.getExtName(pluginName)=="css"){
        url=pluginName;
    }
    else{
        var scripts = document.getElementsByTagName('script');
        for (var i = 0; i < scripts.length; i++) {
            var src = scripts[i].src;
            if (src) {
                var res = src.match(pluginName+".js");
                if (res) {
                    if(!cssName)
                        cssName=pluginName;
                    url = res.input.replace(pluginName+'.js',cssName+ '.css');
                }
            }
        }
    }

    if(url){
        var link = document.createElement("link");
        link.type = "text/css";
        link.rel = "stylesheet";
        link.href = url;
        document.getElementsByTagName("head")[0].appendChild(link);
    }
}
hwc.saveImg=function (src) {
    var image = new Image();
    image.setAttribute("crossOrigin", 'Anonymous');
    image.src = src;
    image.onload = function () {
        var canvas = document.createElement("canvas");
        var ctx = canvas.getContext("2d");
        canvas.width = image.width;
        canvas.height = image.height;
        ctx.drawImage(image, 0, 0);
        var type='png';
        var imgData = canvas.toDataURL(type);
        // 加工image data，替换mime type
        imgData = imgData.replace(_fixType(type),'image/octet-stream');

        var save_link = document.createElementNS('http://www.w3.org/1999/xhtml', 'a');
        save_link.href = imgData;
        save_link.download = "image.png";
        var event = document.createEvent('MouseEvents');
        event.initMouseEvent('click', true, false, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
        save_link.dispatchEvent(event);
    }

    var _fixType = function(type) {
        type = type.toLowerCase().replace(/jpg/i, 'jpeg');
        var r = type.match(/png|jpeg|bmp|gif/)[0];
        return 'image/' + r;
    };
};
hwc.setItemBylocalStorage=function (key,data) {
    localStorage.setItem(key,JSON.stringify(data));
};
hwc.getItemBylocalStorage=function (key) {
    var o=localStorage.getItem(key);
    return o!=null?JSON.parse(o):null;
}
hwc.download=(dataURL, filename)=>{
    var a = document.createElement('a'),
        windowRef;

    // Try HTML5 download attr if supported
    if (a.download !== undefined) {
        a.href = dataURL;
        a.download = filename; // HTML5 download attribute
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } else {
        // No download attr, just opening data URI
        try {
            windowRef = window.open(dataURL, 'chart');
            if (windowRef === undefined || windowRef === null) {
                throw 'Failed to open window';
            }
        } catch (e) {
            // window.open failed, trying location.href
            window.location.href = dataURL;
        }
    }
}
/**
 * 将svg的class样式应用到属性
 */
hwc.setSvgInlineStyles=(target)=>{
    var transformProperties = [ 'fill', 'color', 'font-size', 'stroke', 'stroke-width', 'font' ];

    var svgElems = Array.from(target.getElementsByTagName("svg"));

    for (var svgElement of svgElems) {
        recurseElementChildren(svgElement);
    }

    function recurseElementChildren(node) {
        if (!node.style) return;
        var styles = getComputedStyle(node);

        for (var transformProperty of transformProperties) {
            node.style[transformProperty] = styles[transformProperty];
        }

        for (var child of Array.from(node.childNodes)) {
            recurseElementChildren(child);
        }
    }
}


/**
 * webservice管理
 * ---------------------------------------------------------
 */
/**
 * 添加到webservice的loading
 * @param method
 * @param waitingTip
 */
hwc.addWsLoading=function (method,waitingTip) {
    if (waitingTip.show) waitingTip.show();
    SW.Rpc.loadings.push(method);
}
/**
 * 移除webservice的loading
 * @param method
 * @param waitingTip
 */
hwc.hideWsLoading=function (method,waitingTip) {
    var methodIndex = SW.Rpc.loadings.indexOf(method);
    if (methodIndex != -1)
        SW.Rpc.loadings.splice(methodIndex, 1);
    if (waitingTip && SW.Rpc.loadings.length == 0)
        if (waitingTip.hide) waitingTip.hide();
}

/**
 *添加Promise
 * @param type
 */
hwc.addPromise=(type,promise)=>{
    if(!hwc._promises)
        hwc._promises={};
    if(!hwc._promises[type])
        hwc._promises[type]=[];
    hwc._promises[type].push(promise);
}
/**
 * 关闭Promise
 * @param type
 * @param proxy
 */
hwc.closePromise=(type)=>{
    if(!hwc._promises)
        return;
    _.each(hwc._promises[type],(promise)=> {
        if (promise.xhr) promise.xhr.abort();
    })
    hwc._promises[type]=[];
}
hwc.createNullPromise=()=>{
    new Promise((resolve, reject)=> {
        resolve(null);
    });
}
/**
 * 接口数据与常用数据解析
 * ---------------------------------------------------------
 */
/**
 * 转换市县关系文件结构为最早期的结构
 * @param method
 * @param waitingTip
 */
hwc.transformCityCountyRelation=function (data,provName) {
    var result=provName!=null?[{NAME:provName}]:[];
    _.each(data,function (item) {
        var arr=[{"NAME":item.name}];
        _.each(item.children,function (item1) {
            arr.push({"NAME":item1.name});
        })
        result.push({"NAME":item.name,"COUNTY":arr});
    })
    return result;
};
hwc.wsSimParse=function (data) {
    return data.Rows?data.Rows:data
}
/**
 * 格式化基础数据
 * @param data
 * @returns {Array}
 */
hwc.wsFormatBaseData=function(data){
    if(data==null)
        return null;    var result = [];
    var temp = data["Rows"];
    var fieldName = data["FieldName"];
    if(fieldName==null)
        return hwc.wsSimParse(data);

    for(var t=0;t<temp.length;t++){
        var obj = {};
        for(var f=0;f<fieldName.length;f++){
            var field = fieldName[f];
            var value = temp[t][f];
            obj[field] = value;
        }
        result.push(obj);
    }
    return result
}














