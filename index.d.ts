import {ProjectOptions} from "@vue/cli-service";

type MapResFields = 'provLine' | 'cityLine' | 'countyLine' | 'townLine'
    | 'provName' | 'cityName' | 'countyName' | 'townName' | string;

// 项目运行配置
interface HwConfig {
    base: {
        service: string, // 请求地址
    },
    map?: {
        maxZoom?: number, // 地图最大缩放等级
        minZoom?: number, // 地图最小缩放等级
        zoomLevel?: number, // 缩放倍数
        tiles?: Array<Object>, // 配置瓦片图
        resources: {
            [filed in MapResFields]?: string // 地图资源地址名称
        },
    },
    custom?: { [field: string]: any; }, // 自定义配置
}

// 项目启用配置
type VueConfig = ProjectOptions;

type SysItemConfig<Options = null> = {
    enabled: boolean;
    options?: Options;
};

interface SystemConfig {
    title: string; // 项目名称
    px2rem: SysItemConfig<{
        basePx: number, // 1rem=npx 默认16
        min: number, // 只会转换大于min的px 默认 1
        floatWidth: number, // 转换后的rem值保留的小数点后位数 默认为3
    }>;
}