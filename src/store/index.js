import Vue from 'vue';
import Vuex from 'vuex';
import socket from './modules/socket';

Vue.use(Vuex);

const store = new Vuex.Store({
    state: {},
    mutations: {},
    actions: {},
    modules: {
        socket
    }
});

export default store;
