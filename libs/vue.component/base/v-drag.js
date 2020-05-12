var baseZindex = 999;
var index = 0;
var max =0;
var install = function (Vue, options = {}) {
    // 指令名字
    /** @namespace options.directiveName */
    var name = options.directiveName || 'drag';
    Vue.directive(name, {
        bind (el, binding) {
            var isFixed=el.getAttribute("fixed")!=null;
            var odiv =el;
            var handle = el.getElementsByClassName('v-drag-handle').length>0?
                el.getElementsByClassName('v-drag-handle')[0]:el;
            handle.style.cursor="move";
            var disX = 0;
            var disY = 0;

            var zindexEnable=el.getAttribute("zindexEnable");
            if(zindexEnable){
                el.setAttribute('data-zindex',index);
                el.style.zIndex = baseZindex + index;
            }



            // 记录长度,index最后是个固定值
            index++;
            // 保存最大值，默认没点击时，最大值就是最后一个，max是根据点击动态变化
            max = index;
            var curClientX;
            var curClientY;
            function mouseDownHandle (e) {
                if(zindexEnable){
                    if (el.getAttribute('data-zindex') < max) {
                        el.setAttribute('data-zindex', ++max - 1);
                        el.style.zIndex = baseZindex + max - 1;
                    }
                }
                curClientX=e.clientX;
                curClientY=e.clientY;
                // 算出鼠标相对元素的位置
                if(isFixed){
                    var rect=el.getBoundingClientRect();
                    disX = e.clientX - rect.left;
                    disY = e.clientY - rect.top;
                }
                else{
                    disX = e.clientX - odiv.offsetLeft;
                    disY = e.clientY - odiv.offsetTop;
                }
                //这里的拖动事件只能绑定在外层上，否则快速拖动会有问题
                document.addEventListener('mousemove', mouseMoveHandle);
            }

            function mouseMoveHandle (e) {
                var offsetX=curClientX-e.clientX;
                var offsetY=curClientY-e.clientY;
                if(offsetX==0&&offsetY==0)
                    return;

                let left = e.clientX - disX;
                let top = e.clientY - disY;
                // 移动当前元素
                if(isFixed){
                    if (odiv.style.position !== 'fixed') {
                        odiv.style.position = 'fixed';
                    }
                }
                else{
                    if (odiv.style.position !== 'absolute') {
                        odiv.style.position = 'absolute';
                    }
                }

                odiv.style.left = left + 'px';
                odiv.style.top = top + 'px';
                odiv.style.bottom ="auto";
                odiv.style.right = "auto";
            }

            function mouseUpHandle () {
                document.removeEventListener('mousemove',mouseMoveHandle);
            }
            handle.addEventListener('mousedown', mouseDownHandle);
            document.addEventListener('mouseup',mouseUpHandle);
        }
    })
};

export default install
