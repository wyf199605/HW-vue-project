<template>
    <div class="z-tree-wrapper">
        <ul class="ztree" :id="zTreeId"></ul>
    </div>
</template>

<script>
    import 'ztree/js/jquery-1.4.4.min';
    import 'ztree';
    import 'ztree/js/jquery.ztree.exhide';
    import 'ztree/css/zTreeStyle/zTreeStyle.css';
    import "../style/zTreeExtend.css";

    let getUniqueId = (() => {
        let index = 1000;
        return () => {
            index ++;
            return 'z-tree_id-' + index;
        }
    })();

    export default {
        name: 'ZTree',
        props: {
            data: {required: true, type: Array},
            setting: {type: Object}
        },
        data() {
            return {
                zTreeId: getUniqueId(),
                zTree: null,
            };
        },
        computed: {
            instance() {
                return $.fn.zTree.getZTreeObj(this.zTreeId);
            }
        },
        watch: {
            data() {
                this.initZTree();
            }
        },
        methods: {
            initZTree() {
                let data = this.data;
                if (this.zTree) {
                    this.zTree.destroy();
                    this.zTree = null;
                }
                if (Array.isArray(data)) {
                    this.zTree = $.fn.zTree.init($('#' + this.zTreeId), this.setting, data);
                }
            }
        },
        mounted() {
            this.initZTree();
        }
    }
</script>

<style lang="scss">
</style>