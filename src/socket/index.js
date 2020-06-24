import config from "@/config";
import HwSocket from "@/socket/socket";
import store from "@/store";

if (config.base.wsService) {
    let socket = new HwSocket({
        onMessage() {},
        onError() {},
        url: config.base.wsService
    });
    store.commit('socket/init', socket);
}