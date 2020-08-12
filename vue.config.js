const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const sysConfig = require('./config.sys');
const path = require('path');

const moduleRules = [];

// 是否启用 px2rem
if (sysConfig.px2rem && sysConfig.px2rem.enabled) {
    let options = Object.assign({
        basePx: 16,
        min: 1,
        floatWidth: 3,
        designWidth: 1920,
    }, sysConfig.px2rem.options || {});

    moduleRules.push({
        test: /\.(vue|scss|css)$/,
        loader: 'webpack-px2rem-loader',
        query: options
    });
    process.env.VUE_APP_PX2REM = 'enabled';
    process.env.VUE_APP_PX2REM_DESIGN_WIDTH = options.designWidth;
    process.env.VUE_APP_PX2REM_BASE_PX = options.basePx;
}

process.env.VUE_APP_TITLE = sysConfig.title || '';

/**
 * @type {VueConfig}
 */
module.exports = {
    publicPath: './',
    pluginOptions: {
        // 在scss每个文件下自动导入scss辅助方法
        'style-resources-loader': {
            preProcessor: 'scss',
            patterns: [
                path.resolve(__dirname, 'src/style/helper/index.scss')
            ]
        }
    },
    chainWebpack: config => {
        // load Workers with 'worker-loader'
        let workerReg = /[\\/]src[\\/]workers[\\/][\w.]+?\.js$/;

        config.module
            .rule('worker')
            .test(workerReg)
            .use('worker-loader')
            .loader('worker-loader')
            .end();

        // to avoid cache
        config.module.rule('js').exclude.add(workerReg);

        // to use Babel
        config.module
            .rule('babel-worker')
            .test(workerReg)
            .use('babel-loader')
            .loader('babel-loader')
            .end();
    },
    configureWebpack: {
        module: {
            rules: moduleRules.concat([])
        },
        plugins: [
            new CopyWebpackPlugin([{
                from: path.join(__dirname, process.env.NODE_ENV === 'development' ? './config/config.js' : './config/config.prod.js'),
                to: "config.js",
                force: true
            }]),
        ],
        resolve: {
            alias: {
                hwcommons: path.resolve(__dirname, 'libs/vue.component/base/hwcommons.js'),
                '@libs': path.resolve(__dirname, 'libs')
            }
        },
        optimization: {
            splitChunks: {
                cacheGroups: {
                    vendors: {
                        test: /[\\/]node_modules[\\/]/,
                        name: 'vendors',
                        priority: -10,
                        chunks: 'initial',
                    },
                    libs: {
                        test: /[\\/]libs[\\/]/,
                        name: 'libs',
                        priority: -20,
                        chunks: 'initial',
                    }
                }
            }
        },
    }
};