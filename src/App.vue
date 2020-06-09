<template>
    <div id="app">
        <HelloWorld/>
        <ZTree :data="data"></ZTree>
    </div>
</template>

<script>
    import HelloWorld from "@/components/HelloWorld";
    import ZTree from "@/components/ZTree";

    export default {
        name: "App",
        components: {
            HelloWorld,
            ZTree
        },
        data() {
            return {
                data: [
                    {name: 'aaa'},
                    {name: 'bbb'},
                ]
            }
        }
    }
</script>

<style lang="scss">
    #app {
        @include coverScreen;
    }
</style>
