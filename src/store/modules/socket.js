
export default {
    namespaced: true,
    state: {
        /**
         * @type {HwSocket}
         */
        socket: null,
    },
    mutations: {
        init(state, socket) {
            state.socket = socket;
        }
    },
    actions: {
        sendMessage({state}, data) {
            return state.socket.sendMessage(data);
        }
    },
}
