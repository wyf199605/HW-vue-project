<!--
  时间轴组件
-->
<template>
    <ul class="m-timeLineBar">
        <li v-for="item in times" @click="click(item)" @mouseover="over(item)"  :title="item.desc" :class="{'z-fore':item.mode==='fore','z-sel':item.time.getTime()===curTimestamp}" ></li>
    </ul>
</template>
<script>

    import moment from "moment";

    export default{
        name:'simTimeLine',
        version: "1.0.0",
        data:function () {
            return {
                curTime:this.selDate
            }
        },
        props:{
            //生成时间轴的初始date
            date:{
               type:Date,
               default:function(){
                   return new Date();
               }
            },
            overEnable:Boolean,
            //选择的date
            selDate:Date,
            interval:{
                type:Number,
                default:10
            },
            size:{
                type:Number,
                default:20
            },
            foreSize:{
                type:Number,
                default:0
            },
            foreInterval:{
                type:Number,
                default:60
            },
            timeData:{
                type:Array,
                default:null
            }
        },

        computed:{
            curTimestamp:function () {
                return this.curTime?this.curTime.getTime():null
            },

            times:function () {
                var result=[];
                if(this.timeData){
                    result=_.map(this.timeData,function(item){
                         return {
                                 ...item,
                                desc:moment(item.time).format("YYYY-MM-DD HH:mm:ss")
                         }
                    })
                }
                else{
                    var date=this.getDate(this.date);
                    this.curTime=date;
                    var interval=this.interval;
                    //实况
                    if(this.size){
                        for(var i=this.size;i>=0;i--)
                        {
                            var d=moment(date).add(-1*i*interval,"m");
                            var o={desc:d.format("YYYY-MM-DD HH:mm:ss"),time:d.toDate(),mode:"live"};
                            result.push(o);
                        }
                    }

                    //预报
                    if(this.foreSize){
                        var foreInterval=this.foreInterval;
                        if(foreInterval<=10){
                            date=moment(date).minute(Math.floor(moment(date).minute()/foreInterval)*foreInterval).second(0).toDate();
                        }
                        else{
                            date=moment(date).minute(0).second(0).toDate();
                        }

                        for(var i=0;i<=this.foreSize;i++)
                        {
                            var  d=moment(date).minute(0).add((i+1)*foreInterval,"m");
                            var o={desc:d.format("YYYY-MM-DD HH:mm:ss"),time:d.toDate(),mode:"fore"};
                            result.push(o);
                        }
                    }
                }
                return result;
            }
        },
        methods: {
            click:function(value) {
                this.curTime=value.time;
                this.$emit('select', value);
            },
            over:function (value) {
                if(this.overEnable){
                    this.curTime=value.time;
                    this.$emit('select', value);
                }
            },
            getDate:function (date) {
                var interval=this.interval;
                if(interval<=10){
                    date=moment(date).minute(Math.floor(moment(date).minute()/interval)*interval).second(0).toDate();
                }
                else{
                    date=moment(date).minute(0).second(0).toDate();
                }
                return date;
            }
        },
        watch:{
            selDate:{
                immediate: true,
                handler (value) {
                    if(this.timeData)
                        this.curTime=value;
                    else{
                        this.curTime=this.getDate(value);
                    }
                }
            }
        }

    }
</script>
<style lang="scss" scoped>
    .m-timeLineBar {
        padding-left: 0px;
        font-size: 0px;
        li {
            display: inline-block;
            width: 10px;
            height: 18px;
            background-color: #546070;
            margin-right: 4px;
            cursor: pointer;
        }

        li.z-fore {
            background-color: #2e90fd;
        }

        li.z-sel {
            background-color: #ff5a00;
        }

    }
</style>