import config from '../config';
import ShpWorker from '../workers/shp.worker';

const resources = {};

let getExtName = (fileName) => {
    let pattern = new RegExp("\.([^\.]+)$");
    let r = pattern.exec(fileName);
    return r[1];
};

let unzip = (url) => {
    return new Promise((resolve, reject) => {
        let shpWorker = new ShpWorker();
        shpWorker.onmessage = (e) => {
            resolve(e.data);
        };
        shpWorker.onerror = (e) => {
            reject(e);
        };
        shpWorker.postMessage(url);
    })
};

const Loader = {
    load(name, url) {
        if (name in resources) {
            if (resources[name] instanceof Promise) {
                return resources[name];
            }
            return Promise.resolve(resources[name]);
        }

        let extName = getExtName(url);
        switch (extName) {
            case 'zip':
                return resources[name] = unzip(url).then((data) => {
                    resources[name] = data;
                    return data;
                });
            case 'json':
            default:
                return resources[name] = fetch(url).then((data) => data.json()).then((data) => {
                    resources[name] = data;
                    return data;
                });
        }
    },
    loadMap(name) {
        if (config.map) {
            let mapResources = config.map.resources;
            if (mapResources && name in mapResources) {
                return this.load('map/' + name, mapResources[name]);
            }
        }
        return Promise.reject();
    }
};

export default Loader;
