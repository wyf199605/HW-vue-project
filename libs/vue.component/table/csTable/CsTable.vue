<!--version 1.0.0 -->

<template>
    <table class="m-cs_table">
        <thead ref="thead">
        <tr>
            <th v-for="column in columns" :style="{width:column.width+'px'}"
                :class="getThClass(column)" @click="headClick(column)">
                {{ column.name }}
            </th>
        </tr>
        </thead>
        <tbody :id="csID" class="cs-tbody" :height="tbodyHeight">
        </tbody>
    </table>
</template>

<script>
    import Clusterize from  './lib/clusterize';
    import './lib/jquery.rowspanizer';
    import  moment from 'moment';

    export default {
        name: "CsTable",
        version: "1.0.0",
        props: {
            /**
             * 列表数据集
             * eg:[
             *     {id:xxx,name:'站点1',value:100},                       1. 正常数据
             *     {id:xxx,name:'站点2',value:{value:100,class:''}},      2. 带特殊的class
             *     {id:xxx,name:{value:'站点3',bind:'58847'},value:100}   3. 带td点击事件绑定
             *     {id:xxx,name:站点4',value:100,bind:'58848',class:'cc'} 4. tr带点击事件绑定(bind)，带特殊class
             *    ]                                                     Tip: 被选中的tr,td带有z-select样式
             */
            data:null,
            options: {
                type: Object,
                default: function () {
                    return {
                        //Tip:options每项需在外部全部重设
                        columns: [],
                        indexColumn: {id: 'idx', width: 60, name: '序号'},
                        rowSize: 24,
                        rowspanColumns: [1, 2, 3],// [indices...] | false
                        sortable: false,
                        tableHeight: 700
                    }
                }
            }
        },

        data() {
            return {
                cluster: null,
                tbodyHeight: null,

                sortColumnID:null,
                desc:null,

                selectedTr:null,
                selectedTd:null
            }
        },

        watch: {
            data: function(val){
                this.sortColumnID = null;
                this.desc = null;
                this.cluster.clear();
                this.setRows(val);
            }
        },

        computed: {
            csID() {
                return "cs-tbody"+Sun.Util.stamp(this);
            },

            columns(){
                // Tip:如果有序号列，增在列数据中增加
                return this.options.indexColumn ? [this.options.indexColumn].concat(this.options.columns) : this.options.columns;
            }
        },

        mounted(){
            this.tbodyHeight = this.options.tableHeight ?
                (this.options.tableHeight-this.$refs.thead.clientHeight)+'px' : null;

            var self = this;
            this.cluster = new Clusterize({
                scrollId: self.csID,
                contentId: self.csID,
                keep_parity: false,
                show_no_data_row: false,
                rows_in_block:50,
                blocks_in_cluster: 10,
                callbacks: {
                    clusterWillChange: function() {},
                    clusterChanged: function() {
                        self.setRowspanizer();
                    },
                    scrollingProgress: function(progress) { }
                }
            });

            this.setRows(this.data);
            this.onItemClick();

            var scroller = '#' + this.csID;
            $(scroller).niceScroll({cursorwidth: "10px",autohidemode: false,cursoropacitymax: 0.5,touchbehavior: false });

            console.log('mounted!');
        },

        updated(){
            console.log('updated!');
            this.resetNiceScroll();
        },

        activated(){
            console.log('activated!');
            this.cluster.refresh();
            this.resetNiceScroll();
        },
        methods: {
            setRows(data){
                if(data){
                    var rows = this.getTBody(data);
                    this.cluster.update(rows);
                }
            },

            getTBody(data){
                // Tip: 用string的fromat方法性能很差，所以直接字符串拼接
                var d1 = new Date().getTime();
                var columns = this.columns,indexColumn = this.options.indexColumn;
                var rows = [];
                for(var i=0;i<data.length;i++){
                    var item = data[i];
                    var tr = '<tr data-bind="'+(item.bind||'') +'" class="'+(item.class||'') +'">';
                    for(var j=0;j<columns.length;j++){
                        var col = columns[j];
                        var text = '',_class='',bind='';
                        if(indexColumn && j==0 )
                            text = i+1;
                        else if(item[col.id]!=null){
                            var o = item[col.id];
                            _class = o.class ? ' class='+o.class : '';
                            bind = o.bind ? ' data-bind='+o.bind : '';
                            text = o.class || o.bind ? o.value : o;
                        }
                        tr += '<td style="width:'+col.width+'px"'+_class + bind +'>'+text+'</td>';
                    }
                    rows.push(tr);
                }
                var d2 = new Date().getTime();
                console.log(data.length,(d2-d1)/1000+'s');
                return rows;
            },

            getThClass(column){
                if(this.sortColumnID==column.id)
                    return this.desc ? 'desc' :'asc';
                return '';
            },

            headClick(column){
                if(this.options.sortable){
                    this.sortColumnID = column.id;
                    this.desc = column.desc = !column.desc;
                    this.sortColumn(column);
                    console.log(column.name);
                }
            },

            sortColumn:function(column){
                var sort_v = column.desc ? -1 : 1;
                if(column.type == 'text'){
                    var strArray=_.pluck(this.data,column.id);
                    if(typeof strArray[0] == 'object')
                        strArray=_.pluck(strArray,'value');
                    strArray=_.filter(strArray,function (item) {
                        return item!=null;
                    })
                    strArray = strArray.sort(function(a,b){return a.localeCompare(b)});
                }
                var data = _.sortBy(this.data,function (item) {
                        var value = item[column.id];
                        value = typeof value == 'object' ? value.value : value;
                        if(value==null||value==='')
                            return 1000000;
                        else if(column.type === 'number')// 0==''为true
                            return (_.isNumber(value)&&isNaN(value)) ? 1000000 : sort_v * value;
                        else if(column.type === 'date')
                            return sort_v * moment(value,column.format).unix();
                        else if(column.type === 'text')
                            return sort_v * strArray.indexOf(value);
                    });
                this.setRows(data);
            },

            onItemClick(){
                var self = this;
                $(document).on("click",'#'+this.csID+' tr',function () {
                    var item = $(this).data('bind');
                    if(typeof item != "undefined" && item!=''){
                        self.$emit('itemClick', item);
                        if(self.selectedTr)
                            self.selectedTr.removeClass('z-select');
                        $(this).addClass('z-select');
                        self.selectedTr = $(this);
                    }
                });
                $(document).on("click",'#'+this.csID+' td',function () {
                    var item = $(this).data('bind');
                    if(typeof item != "undefined" && item!='') {
                        self.$emit('itemClick', item);
                        if (self.selectedTd)
                            self.selectedTd.removeClass('z-select');
                        $(this).addClass('z-select');
                        self.selectedTd = $(this);
                    }
                });
            },

            setRowspanizer(){
                var rowspanColumns = this.options.rowspanColumns;
                if(rowspanColumns)
                    $('#'+this.csID).rowspanizer({vertical_align: 'middle', columns: rowspanColumns});
            },

            resetNiceScroll(){
                var scroller = '#' + this.csID +' .cs-scroller';
                $(scroller).getNiceScroll().resize();
            }
        }
    }
</script>

<style lang="scss">

    .m-cs_table{
        border-collapse: collapse;
        color :#444;
        font-size: 14px;
        border-bottom: 1px solid #9dc1e6;

        .z-select{
            background: pink;
        }

        thead{
            display: table;
            /*table-layout:fixed;*/
            /*display: block;*/
            width: 100%;
        }
        .cs-x-scroll thead{
            /*width: calc( 100% - 1em );*/
        }

        tbody tr {
            /*display:table-row;*/
            /*table-layout:fixed;*/
            width:100%;
            position: relative;
        }
        thead tr{
            display: block;
        }
        thead th{
            background-color: #e6f3fc;
            cursor: pointer;
        }
        tbody {
            display:block;
            margin-top:-1px;
            overflow:auto;
        }
        th, td {
            border-left: 1px solid #9dc1e6;
            border-top: 1px solid #9dc1e6;
            text-align: center;
            height: 24px;
            padding: -24px;
            word-break: break-all;
            box-sizing: border-box;
        }

        th:last-child,td:last-child{
            border-right: 1px solid #9dc1e6;
        }
        tr:last-child{
            /*border-bottom: 1px solid #9dc1e6;*/
        }
        th.desc::after,th.asc::after{
            margin-left: 2px;
            content: '';
            height: 10px;
            width: 5px;
            background-size: contain;
            background-repeat: no-repeat;
            background-position-x: left;
            display: inline-block;
        }
        th.desc::after{
            background-image: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAoCAYAAAD+MdrbAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyFpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuNi1jMTQyIDc5LjE2MDkyNCwgMjAxNy8wNy8xMy0wMTowNjozOSAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENDIChXaW5kb3dzKSIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDo1REQ5OEM1NUQ2OEMxMUU4OTIxMTk3MEEwMThFMTRGNCIgeG1wTU06RG9jdW1lbnRJRD0ieG1wLmRpZDo1REQ5OEM1NkQ2OEMxMUU4OTIxMTk3MEEwMThFMTRGNCI+IDx4bXBNTTpEZXJpdmVkRnJvbSBzdFJlZjppbnN0YW5jZUlEPSJ4bXAuaWlkOjVERDk4QzUzRDY4QzExRTg5MjExOTcwQTAxOEUxNEY0IiBzdFJlZjpkb2N1bWVudElEPSJ4bXAuZGlkOjVERDk4QzU0RDY4QzExRTg5MjExOTcwQTAxOEUxNEY0Ii8+IDwvcmRmOkRlc2NyaXB0aW9uPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8+/7McSQAAANlJREFUeNpi/G/AgA/YAPFhNDFbID4C553/jyLJxEBlMGrgqIGjBo4aOGrgqIGjBg5jA1mgzQ1SAUKPISOKBCOwbXMWSBtRyYFnQF4uBuJPVDAMZEYpyMADQBxNBQOjgS2xA7BI+QDEyRQYlgw1Ax7LoPbeLSCuJ8OwerDe8/+PwGKZAclQEFAH4igiDVsCxPtghqEbiGyoBhExfwaIZyIbhithHyEi5sExitI0JpBTCMV8NFQNSVkPV8zDY5RUA7HFfD1U7Ai+vMxAwFAQUIXS+/AZBgIAAQYAP/4ymQgZCXAAAAAASUVORK5CYII=);
        }
        th.asc::after{
            background-image: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAoCAYAAAD+MdrbAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyFpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuNi1jMTQyIDc5LjE2MDkyNCwgMjAxNy8wNy8xMy0wMTowNjozOSAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENDIChXaW5kb3dzKSIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDo2QUFCQzZGNkQ2OEMxMUU4ODhERjhGRUVBN0RBNEFDMCIgeG1wTU06RG9jdW1lbnRJRD0ieG1wLmRpZDo2QUFCQzZGN0Q2OEMxMUU4ODhERjhGRUVBN0RBNEFDMCI+IDx4bXBNTTpEZXJpdmVkRnJvbSBzdFJlZjppbnN0YW5jZUlEPSJ4bXAuaWlkOjZBQUJDNkY0RDY4QzExRTg4OERGOEZFRUE3REE0QUMwIiBzdFJlZjpkb2N1bWVudElEPSJ4bXAuZGlkOjZBQUJDNkY1RDY4QzExRTg4OERGOEZFRUE3REE0QUMwIi8+IDwvcmRmOkRlc2NyaXB0aW9uPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8+peiJ0QAAAOFJREFUeNpi/G/AQAjYAHE6lD0TiI+gyJ7/j8JlIcIwJyCOgfJvQ+kjuDSwEDBMDYgbkcRA7Cf4DGXCY6AAEM/FIj4XKsdAioEOQLwUj2VLoWqIMhDk1V4g5sNjIEiuG6oWr4EgBZlAbMRAGJiAY9+Q0QaXgbAYjWIgHsSA9SAZyghNh7AYnctAHkgG4lvANHmEiUCMEgvgMQ9yISi2NhKIBGLAJyD2Bxl4lshIIAacARloQ0DRYTS+LT7FLPjyJbZ0hpHt0AoHJgYqg1EDRw0cNXDUwFEDRw0cNXAYGwgQYACWbicljckklgAAAABJRU5ErkJggg==);
        }
    }
</style>
