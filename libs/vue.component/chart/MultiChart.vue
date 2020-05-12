<!--
单站面板组件
-->
<template>
        <highcharts :options="chartOptions" ></highcharts>
</template>
<script>

    import Highcharts from 'highcharts';
    import highchartsVue from 'highcharts-vue';
    import Vue from "vue";
    import moment from "moment";

//    import exportingInit from 'highcharts/modules/exporting';
   // exportingInit(Highcharts)
    Vue.use(highchartsVue);
    var path=[];

    Highcharts.setOptions({
            global: {
                    timezoneOffset: 8*60,
                    useUTC:false
            }
    })
    var getWindDirection = function (dir, speed) {
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

    var drawPlotLines = function (chart,context) {
            var now=moment();
            var index=_.findIndex(context.data,function (item) {
                 return moment(item.HAPPENTIME).unix()>now.unix();
            })

            if(index==-1)
               return;
            var xAxis = chart.xAxis[0],
                    x,
                    pos,
                    max,
                    isLast,
                    i;
            for (pos = xAxis.min, max = xAxis.max, i = 0; pos <= max + 36e5; pos += 36e5, i += 1) {
                    isLast = pos === max + 36e5;
                    x = Math.round(xAxis.toPixels(pos)) + (isLast ? 0.5 : -0.5);
                    if(i == index){
                            var path=chart.renderer.path(['M', x-2, 30,
                                    'L', x-2, 290, 'Z'])
                                    .attr({
                                            'stroke': "#E60202",
                                            'stroke-width': 2
                                    })
                                    .add();
                            addPath(path);
                    }
            }
    };

    var tooltipFormatter = function (tooltip,context) {
            var data=_.find(context.data,function (item) {
                    return moment(item.HAPPENTIME).valueOf()==tooltip.x;
            });
            var s="";
            if(!data)
               return s;

            if(context.interval==60){
                 s=moment(data.HAPPENTIME).format("MM月DD日 HH时");
            }
            else if(context.interval<60){
                 s=moment(data.HAPPENTIME).format("MM月DD日 HH时mm分");
            }
            else if(context.interval>=24*60){
                 s=moment(data.HAPPENTIME).format("MM月DD日");
            }
            var ret = '<div><small>' +  s +'</small><br>';
            ret += '<table>';



            Highcharts.each(tooltip.points, function (point) {
                    var series = point.series;
                    var name = series.name;
                    if(name=="能见度")
                        return;
                    ret += '<tr><td style="display:inline-block;width:80px;font-size:12px;"><span style="color:' + series.color + '">\u25CF</span> ' +name +
                            ': </td><td style="width:80px;white-space:nowrap;font-size:12px;">' + Highcharts.pick(point.point.value, point.y) +
                            series.options.tooltip.valueSuffix + '</td></tr>';
            });
            if(context.visEnable&&data[context.options.visField]!=null&&data[context.options.visHappenTimeField]!=null){
                   ret += '<tr><td style="display:inline-block;width:80px;font-size:12px;"><span>\u25CF</span> ' +"最小能见度" +
                  ': </td><td style="min-width:80px;white-space:nowrap;font-size:12px;">'+data[context.options.visField]
                   'km</td></tr>';
                  ret += '<tr><td style="display:inline-block;width:80px;font-size:12px;"><span>&nbsp;&nbsp; ' +"(出现时间)" +
                   ': </td><td style="min-width:80px;white-space:nowrap;font-size:12px;">'+ moment(data[context.options.visHappenTimeField]).format("DD日HH时mm分")+ '</td></tr>';
            }
            // Add wind
            if(context.windEnable){
                    ret += '<tr><td style="min-width:80px;font-size:12px;vertical-align: top">\u25CF 风</td><td style="width:100px;white-space:nowrap;font-size:12px;">'
                            + getWindDirection(data[context.options.windField[1]]) +
                            '<br>' + data[context.options.windField[2]]+ '级 (' +
                           data[context.options.windField[0]] + ' m/s)</td></tr>';
            }
            ret += '</table></div>';
            return ret;
    };

    var windArrow = function (level) {
            switch (level){
                    case 0:
                    case 1:
                    case 2:
                    case 3: return ['M',0,7,'L',-1.5,7,0,10,1.5,7,0,7,0,-10,'M',0,-8,'L',4,-8];
                    case 4: return ['M',0,7,'L',-1.5,7,0,10,1.5,7,0,7,0,-10,0,-10,7,-10];
                    case 5: return ['M',0,7,'L',-1.5,7,0,10,1.5,7,0,7,0,-10,0,-10,7,-10,'M',0,-7,'L',4,-7];
                    case 6: return ['M',0,7,'L',-1.5,7,0,10,1.5,7,0,7,0,-10,0,-10,7,-10,'M',0,-7,'L',7,-7,'M',0,-4,'L',4,-4];
                    case 7: return ['M',0,7,'L',-1.5,7,0,10,1.5,7,0,7,0,-10,0,-10,7,-10,'M',0,-7,'L',7,-7,'M',0,-4,'L',7,-4];
                    case 8: return ['M',0,7,'L',-1.5,7,0,10,1.5,7,0,7,0,-10,0,-10,7,-10,'M',0,-7,'L',7,-7,'M',0,-4,'L',7,-4,'M',0,-1,'L',7,-1];
                    case 9: return ['M',0,7,'L',-1.5,7,0,10,1.5,7,0,7,0,-10,0,-10,7,-10,'M',7,-10,'L',0,-7];
                    case 10: return ['M',0,7,'L',-1.5,7,0,10,1.5,7,0,7,0,-10,0,-10,7,-10,'M',7,-10,'L',0,-7,7,-7];
                    case 11: return ['M',0,7,'L',-1.5,7,0,10,1.5,7,0,7,0,-10,0,-10,7,-10,'M',7,-10,'L',0,-7,7,-7,'M',0,-4,'L',7,-4];
                    case 12: return ['M',0,7,'L',-1.5,7,0,10,1.5,7,0,7,0,-10,0,-10,7,-10,'M',7,-10,'L',0,-7,7,-7,'M',0,-4,'L',7,-4,'M',0,-1,'L',7,-1];
                    case 13: return ['M',0,7,'L',-1.5,7,0,10,1.5,7,0,7,0,-10,0,-10,7,-10,'M',7,-10,'L',0,-7,7,-7,'M',0,-4,'L',7,-4,'M',0,-1,'L',7,-1,'M',0,2,7,2];
                    case 14: return ['M',0,7,'L',-1.5,7,0,10,1.5,7,0,7,0,-10,0,-10,7,-10,'M',7,-10,'L',0,-7,7,-7,0,-4];
                    case 15: return ['M',0,7,'L',-1.5,7,0,10,1.5,7,0,7,0,-10,0,-10,7,-10,'M',7,-10,'L',0,-7,7,-7,0,-4,7,-4];
                    case 16: return ['M',0,7,'L',-1.5,7,0,10,1.5,7,0,7,0,-10,0,-10,7,-10,'M',7,-10,'L',0,-7,7,-7,0,-4,7,-4,'M',0,-1,'L',7,-1];
                    case 17: return ['M',0,7,'L',-1.5,7,0,10,1.5,7,0,7,0,-10,0,-10,7,-10,'M',7,-10,'L',0,-7,7,-7,0,-4,7,-4,'M',0,-1,'L',7,-1,'M',0,2,'L',7,2];
                    default: return ['M',0,7,'L',-1.5,7,0,10,1.5,7,0,7,0,-10,0,-10,7,-10,'M',7,-10,'L',0,-7,7,-7,0,-4,7,-4,'M',0,-1,'L',7,-1,'M',0,2,'L',7,2];
            }
    };

    var addPath=function (item) {
          path.push(item);
    }

    var clearPath=function () {
            _.each(path,function (item) {
                    item.element.remove();
            })
            path=[];
    }


    var drawWindArrows = function (chart,context,windEnable) {
            if(!windEnable)
                    return;
            _.each(chart.series[0].data, function (i, point) {

                    var sprite, arrow, x, y;
                    if (i.index % 1 === 0) {
                            // Draw the wind arrows
                            x = i.plotX + chart.plotLeft;
                            y = chart.plotHeight+chart.plotTop+30/2;
                            var item=context.data[i.index];
                            if (item[context.options.windField[0]]==0) {
                                    arrow = chart.renderer.circle(x, y, 10).attr({
                                            fill: 'none'
                                    });
                            }
                            else if(item[context.options.windField[1]]!=null&&item[context.options.windField[2]]!=null){
                                    arrow = chart.renderer.path(
                                            windArrow(item[context.options.windField[2]])
                                    ).attr({
                                            rotation: parseFloat(item[context.options.windField[1]], 10),
                                            translateX: x, // rotation center
                                            translateY: y // rotation center
                                    });
                            }

                            if(arrow){
                                    arrow.attr({
                                            stroke: (Highcharts.theme && Highcharts.theme.contrastTextColor) || 'black',
                                            'stroke-width': 1.5,
                                            zIndex: 5
                                    }).add();
                                   addPath(arrow);
                            }
                    }
            });
    };

     var fitSeries=function (options) {
         _.each(options.series,function (item) {
                item.data=_.clone(item.data).reverse();
         })
    }

    var parseData=function (data,field) {
          return _.map(data,function (item) {
                return {x:moment(item.HAPPENTIME).valueOf(),y:item[field]}
          })
    }

    export default{
        name:'multiChart',
        props:{
                interval:{
                        type:Number,
                        default:60
                },
                data:{
                        type:Array,
                        default:null
                },
                options:{
                        type:Object,
                        default:function () {
                              return {
                                      tempField:"AIRTEMP_CURRENT_VALUE",
                                      rainField:"RAIN_SUM_CURHOUR_VALUE",
                                      rhField:"RH_CURRENT_VALUE",
                                      visField:"VISIBILITY_MIN_VALUE",
                                      visHappenTimeField:"VISIBILITY_MIN_HAPPENTIME",
                                      windField:["WIND_CURRENT_SPEEDVALUE","WIND_CURRENT_DIRVALUE","WIND_CURRENT_POWERVALUE"]

                              }
                        }
                },
                yAxis:{
                        type:String,
                        default:"temp"
                },
                tempEnable:{
                        type:Boolean,
                        default:true,
                },
                rainEnable:{
                        type:Boolean,
                        default:true,
                },
                rhVisible:{
                        type:Boolean,
                        default:true,
                },
                visEnable:{
                        type:Boolean,
                        default:true,
                },
                windEnable:{
                        type:Boolean,
                        default:true,
                }
        },
        components: {

        },
        computed:{
            chartOptions:function () {
                    var topDateformatter="MM月DD日";
                    var bottomDateformatter="HH";
                    if(this.interval<=12*60){
                            bottomDateformatter="HH"
                            topDateformatter="MM月DD日";
                            if(this.interval==3*60||this.interval==6*60){
                                    topDateformatter="DD日HH时";
                            }
                            else{
                                    topDateformatter="DD日";
                            }
                    }
                    else if(this.interval==24*60){
                            bottomDateformatter="DD日";
                            topDateformatter="";
                    }
                    var data=this.data;
                    if(data==null)
                        data=[];
                var that=this;
                this.windEnable;
                var options= {
                        "chart": {
                                "marginBottom": 70,
                                "marginRight": 40,
                                "marginTop": 50,
                                "plotBorderWidth": 1,
//                                animation:false,
                                "width": 810,
                                "height": 360,
                                events:{
                                    render:function () {
                                        clearPath();
                                        drawWindArrows(this,that,that.windEnable);
                                        drawPlotLines(this,that);
                                    }
                                }

                        },
                        "title": {
                                "text": "",
                                "align": "left"
                        },
                        "credits": {
                                "enabled": false,
                        },
                        "tooltip": {
                                "shared": true,
                                "useHTML": true,
                                formatter: function () {
                                        return tooltipFormatter(this,that);
                                },
                                borderWidth:1,
                                borderColor:"rgba(219, 219, 216, 0.8)",
                                backgroundColor:"rgba(219, 219, 216, 0.8)",
                                shadow:false
                        },
                        "xAxis": [
                                { // Bottom X axis
                                        type: 'datetime',
                                        tickInterval:   36e5,
                                        minorTickInterval:36e5,
                                        tickLength: 0,
                                        gridLineWidth: 0.01,
                                        gridLineColor: (Highcharts.theme && Highcharts.theme.background2) || '#F0F0F0',
                                        startOnTick: false,
                                        endOnTick: false,
                                        minPadding: 0,
                                        maxPadding: 0,
                                        floor:true,
                                        offset: 30,
                                        showFirstLabel: true,
                                        showLastLabel: true,
                                        labels: {
                                                formatter:function () {
                                                        return moment(this.value).format(bottomDateformatter);
                                                },
                                                style: {
                                                        fontSize: '14px'
                                                },
                                                padding:0,
                                                x:0,
                                                align: 'left'
                                        }
                                },
                        ],
                        "yAxis": [{
                                "title": {
                                        "text": null
                                },
                                "labels": {
                                        "format": "{value}℃",
                                        "style": {
                                                "fontSize": "14px"
                                        },
                                        "x": -10
                                },
                                minorTickInterval:"auto",
                                visible:this.yAxis=="temp",
                        }, {
                                "title": {
                                        "text": null
                                },
                                "labels": {
                                        "format": "{value}mm",
                                        "style": {
                                                "fontSize": "14px"
                                        },
                                        "x": -10
                                },
                                minorTickInterval:"auto",
                                visible:this.yAxis=="rain"
                        },
                                {
                                "title": {
                                        "text": null
                                },
                                "max": 100,
                                "min": 0,
                                "labels": {
                                        "format": "{value}%",
                                        "style": {
                                                "format": "{value}%",
                                                "fontSize": "14px"
                                        },
                                        "x": -10
                                },
                                minorTickInterval:"auto",
                                visible:this.yAxis=="rh",
                                "opposite": false
                        },
                                {
                                "title": {
                                        "text": null
                                },
                                "labels": {
                                        "format": "{value}km",
                                        "style": {
                                                "format": "{value}km",
                                                "fontSize": "14px",
                                                "color": "#606060"
                                        },
                                        "x": -10
                                },
                                 minorTickInterval:"auto",
                                 visible:this.yAxis=="vis",
                        }
                        ],
                        "legend": {
                                "enabled": false
                        },
                        "plotOptions": {
                                "series": {
                                        "pointPlacement": "between",
                                        "lineWidth": 3.5,
                                        "connectNulls": false
                                }
                        },
                };

                    if(this.interval<24*60){
                            options.xAxis.push(
                                    { // Top X axis
                                            linkedTo: 0,
                                            type: 'datetime',
                                            tickInterval: 24 * 3600 * 1000,
                                            labels: {
                                                    formatter: function () {
                                                            var date = new Date(this.value);
                                                            return moment(date).format(topDateformatter);
                                                    },
                                                    align: 'left',
                                                    x: 3,
                                                    y: -5
                                            },
                                            opposite: true,
                                            tickLength: 20,
                                            gridLineWidth: 1
                                    }
                            )
                            if(this.interval!=60){
                                    options.xAxis[0].type=options.xAxis[1].type="linear";
                                    fitSeries(options);
                            }
                    }
                    else{
                            options.xAxis[0].type="linear";
                            options.chart.marginTop=45;
                            fitSeries(options);
                    }

                    var series=[];
                    if(this.tempEnable){
                            var tempData=parseData(data,this.options.tempField);
                            series.push({
                                            "name": "气温",
                                            "data": tempData,
                                            "type": "spline",
                                            "marker": {
                                                    "enabled": true,
													"symbol": 'circle',
													"radius": 5,
													"lineWidth": 2,
													"lineColor": "#FF925F",
													"fillColor": "#fff",
                                                    "states": {
                                                            "hover": {
                                                                    "enabled": true
                                                            }
                                                    }
                                            },
                                            dataLabels: {
                                                enabled: false,
                                            },
                                            "tooltip": {
                                                    "valueSuffix": "°C"
                                            },
                                            "zIndex": 1,
                                            "yAxis": 0,
                                            "color": "#FF925F"
                                    }
                            )
                    }
                    if(this.rainEnable){
                            var rainData=parseData(data,this.options.rainField);
                            series.push(
                                    {
                                    "name": "降水",
                                    "data":rainData ,
                                    "type": "column",
                                    "color": "#38B3ED",
                                    "groupPadding": 0,
                                    "pointPadding": 0,
                                    "borderWidth": 0,
                                    "pointWidth": 20,
                                    "shadow": false,
                                    "yAxis": 1,

                                    "dataLabels": {
                                            "enabled": true,
                                            "style": {
                                                    "fontSize": "14px",
													"color": "#38B3ED"
                                            },
                                            formatter:function () {
                                                    if(this.y==null||this.y==0)
                                                        return "";
                                                    else
                                                         return this.y;
                                            }
                                    },
                                    "tooltip": {
                                            "valueSuffix": "mm"
                                    }
                            })
                    }
                    if(this.visEnable){
                            var visData=parseData(data,this.options.visField);
                            series.push(
                                    {
                                    "name": "能见度",
                                    "data": visData,
                                    "type": "spline",
                                            "marker": {
                                                    "enabled": true,
													"symbol": 'circle',
													"radius": 5,
													"lineWidth": 2,
													"lineColor": "#C111C7",
													"fillColor": "#fff",
                                                    "states": {
                                                            "hover": {
                                                                    "enabled": true
                                                            }
                                                    },
											},
                                    "tooltip": {
                                            "valueSuffix": "km"
                                    },
                                    "zIndex": 1,
                                    "yAxis": 3,
                                    "color": "#C111C7",
                            })
                    }
                    if(this.rhEnable){
                            var rhData=parseData(data,this.options.rhField);
                            series.push(
                                    {
                                    "name": "相对湿度",
                                    "data":parseData(data,rhData),
                                    "type": "spline",
                                    "marker": {
                                            "enabled": false,
                                            "states": {
                                                    "hover": {
                                                            "enabled": true
                                                    }
                                            }
                                    },
                                    "tooltip": {
                                            "valueSuffix": "%"
                                    },
                                    "zIndex": 1,
                                    "yAxis": 2,
                                    "color": "#1bac00",
                                    "dashStyle": "shortdot"
                            })
                    }
                options.series=series;
                return options;
            }
        },
       watch:{

       },
        methods:{

        }
    }
</script>
<style lang="scss" scoped>

</style>
