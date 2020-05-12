
<!--version 1.0.0 -->

<template>
    <div class="m-sl_legend" :vertical="options.vertical">
        <div class="ul-container">
            <ul class="v-drag-handle"
                :vertical="options.vertical"
                :numPosition="options.numPosition"
                :numAlign="options.numAlign"
                ref="legend">
                <li v-for="(item, index) in data"
                    v-if="!item.hide"
                    :style="getCellStyle(item,index)">
                    <span v-text="getValue(item)"></span>
                </li>
            </ul>
            <div class="slider" :style="getSliderStyle()" v-if="options.slidable && data">
                <el-slider
                        v-model="value"
                        :max="max"
                        :show-tooltip="false"
                        :range="range"
                        :height="height"
                        :vertical="options.vertical"
                        @change="sliderChange">
                </el-slider>
            </div>
        </div>
        <div class="unit"
             :vertical="options.vertical"
             :position="options.unitPosition"
             v-if="options.unit && data">
            {{options.unit}}
        </div>
    </div>
</template>

<script>
    export default {
        name: "SliderLegend",
        version: "1.0.0",

        props: {
            legendData: null,
            options:{
                //Tip:options每项需在外部全部重设
                type: Object,
                default: function () {
                    return{
                        vertical: false,
                        gradient:false,
                        unit:null,
                        numAlign: 'middle',
                        numPosition:'left',
                        cell_width:'40px',
                        cell_height:'20px',
                        scaleField: 'min',
                        slidable: true,
                        sliderDir: 'both',// gt/lt/both
                        sliderRange: null // slider的范围,null|[3,8]
                    }
                }
            }
        },

        data() {
            return {
                height:null,
                value: this.getSliderRange()
            };
        },
        watch: {
            legendData:function (val, oldVal) {
                this.value = this.getSliderRange();
            },
            'options.sliderDir':function (val) {
                this.value = this.getSliderRange();
            },
            'options.sliderRange':function (val) {
                this.value = this.getSliderRange();
            }
        },
        computed: {
            data(){
                return this.options.vertical&&this.legendData?this.legendData.slice().reverse():this.legendData;
            },
            max(){
                return this.legendData.length;
            },
            range(){
                return this.options.sliderDir === 'both';
            }
        },
        updated:function () {
            this.height = (this.$refs.legend ? this.$refs.legend.clientHeight : 0) +'px';
        },
        methods: {
            getSliderRange(){
                var sDir = this.options.sliderDir;
                if(this.legendData){
                    var max = this.legendData.length;
                    return this.options.sliderRange?this.options.sliderRange:
                        (sDir === 'both' ? [0, max] : (sDir === 'gt' ? 0 : max));
                }
            },
            getValue(item){
                var value = item[this.options.scaleField];
                value = typeof value == 'string' ? value : (isNaN(value) || value == -9999 ? '' : value);//Tip:null似乎会自动屏蔽，故不判断
                return value;
            },
            getCellStyle(item,index){
                var color = item.color,opts = this.options,legendData = this.legendData;
                if(this.value){
                    var sDir = opts.sliderDir;
                    var idx = opts.vertical ? (legendData.length - index - 1) : index;
                    if(sDir === 'both')
                        color = (idx < this.value[0] || idx >= this.value[1]) ? getGray(color) : getColor();
                    else
                        color = (sDir==='gt' && idx<this.value) || (sDir==='lt' && idx>=this.value) ? getGray(color) : getColor();
                }
                return {background:color,width: opts.cell_width,height:opts.cell_height};

                function getColor() {
                    if(!opts.gradient)
                        return color;
                    else{
                        var next = idx==legendData.length-1 ? idx : idx+1;
                        var dir = opts.vertical ? 'top':'right';
                        return 'linear-gradient(to {0},{1},{2})'.format(dir,color,legendData[next].color);
                        // var prev = index==0? index : index-1;
                        // if(opts.numAlign == 'ruler')
                        // else if(opts.numAlign == 'middle')
                        //     return 'linear-gradient(to right,{0},{1},{2})'.format(legendData[prev].color,color,legendData[next].color);
                    }
                }

                function getGray(c) {
                    c = Sun.Util.Color.colorToRgb(c,1);
                    return  'rgb('+c[0]*0.5 +','+ c[1]*0.5 +','+ c[2]*0.5+')';
                }
            },
            getSliderStyle(){
                //{width: (parseFloat(this.options.cell_width)+2)+'px'}
                return this.options.vertical ? {width: (parseFloat(this.options.cell_width)+2)+'px'}:
                    {top:(-parseFloat(this.options.cell_height)/2-8)+'px'};
            },
            sliderChange(value) {
                var sDir = this.options.sliderDir;
                var initial = sDir == 'both' ? value[0] == 0 && value[1] == this.max :
                    (sDir==='gt' ? value == 0 : value == this.max);
                this.$emit('slider-change', initial?{initial:initial,value:value}:value);
            }
        }
    }
</script>

<style lang="scss">

    /* 清理浮动 */
    .clearfix:after{content:'.';display: block;clear: both;height: 0;overflow: hidden;visibility: hidden;}
    .m-sl_legend{
        position: relative;
        display: inline-block;

        .unit{
            text-shadow: #fff 1px 0 0, #fff 0 1px 0, #fff -1px 0 0, #fff 0 -1px 0;
            margin: 0 5px;
        }
        [vertical].unit{
            margin: 5px 0;
        }
        [position=right].unit{
            float: right;
        }
        [position=left].unit{
            float: left;
        }
        [position=top].unit{
            position: absolute;
            top: -30px;
            left: 0;
            white-space: nowrap;
        }

        .ul-container{
            display: inline-block;
        }
        ul {
            list-style: none;
            padding: 0;
            margin: 0;
        }
        li{
            position: relative;
            border: 1px solid #333;
            display: inline-block;
            border-left: none;
        }
        li:first-child{
            border-left: 1px solid #333;
        }
        [vertical] li{
            display: block;
            border-top: none;
            border-left: 1px solid #333;
        }
        [vertical] li:first-child{
            border-top: 1px solid #333;
        }
        span{
            position: absolute;
            text-align: center;
            top: 100%;
            width: 100%;
            text-shadow: #fff 1px 0 0, #fff 0 1px 0, #fff -1px 0 0, #fff 0 -1px 0;
        }
        [numPosition=top] span{
            top: auto;
            bottom: 100%;
        }
        [numAlign=ruler] span{
            right: 50%;
        }
        [vertical] span{
            top: 0;
            left: 100%;
            height: 100%;
            text-align: left;
            margin:auto auto auto 5px;
        }
        [vertical][numPosition=left] span{
            left: auto;
            right: 100%;
            text-align: right;
            margin:auto 7px auto auto;
        }
        [vertical][numAlign=ruler] span{
            top: 50%;
        }
    }


    /deep/.slider{
        position: relative;

        .el-slider__runway {
            background-color: rgba(0,0,0,0);
            margin: 0 auto;
            height: 0;
        }
        .el-slider__bar {
            height: 100%;
            background-color: rgba(0,0,0,0);
            position: absolute;
        }
        .el-slider__button {
            width: 10px;
            height: 10px;
            border: 1px solid #333;
            background-color: #fff;
            border-radius: 50%;
            -webkit-transition: .2s;
            transition: .2s;
            -webkit-user-select: none;
            user-select: none;
        }
    }

    [vertical] .unit,.ul-container{
        display: block;
    }

    [vertical] .slider{
        position: absolute;
        top: 0;
    }

</style>
