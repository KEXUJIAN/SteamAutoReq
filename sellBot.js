; (async function autobot($) {
    "use strict";
    if (!($ instanceof Function)) {
        return console.error("jQuery 未定义");
    }
    window.addEventListener("error", function (evt) {
        console.error("autobot 发生错误", evt);
    });
    class MyError extends Error {
        constructor(msg, data) {
            super(msg);
            this.data = data;
        }
    }
    const BotState = {
        "paused": 0,
        "Running": 1
    }
    class AutoBot extends EventTarget {
        constructor() {
            super();
            this.assets;
            this.descriptions;
            this.cardClsIds = {};
            this.sellSuccLog = [];
            this.sellFailLog = [];
            this.state = 0;
            this.crtIdx = 0;
        }

        start() {
            this.dispatchEvent(new Event('start'));
        }

        pause() {
            this.dispatchEvent(new Event('pause'));
        }

        async init() {
            this.addEventListener('start', () => {
                if (this.state === BotState.Running) {
                    this.log('bot 已经在运行');
                    return;
                }
                this.log('bot 开始卖卡');
                this.state = BotState.Running;
                this.doSell(this.crtIdx);
            })
            this.addEventListener('pause', () => {
                this.log('正在暂停');
                if (this.state === BotState.paused) {
                    return;
                }
                this.state = BotState.paused;
            });
            await this.getSoldableCards();
            await this.sleep(1500);
            this.log('初始化成功, 共', this.assets.length, '张卡片');
        }

        async doSell(idx = 0) {
            for (let i = idx; i < this.assets.length; i++) {
                this.crtIdx = i;
                if (this.state === BotState.paused) {
                    this.log('bot 暂停, 下一个 id', this.crtIdx);
                    return;
                }
                let asset = this.assets[i];
                await this.logSell(asset);
                await this.sleep(Math.floor(Math.random() * 5000 + 15000));
            }
        }

        async logSell(asset) {
            let descIdx = this.cardClsIds[asset.classid];
            let desc = this.descriptions[descIdx];
            let result = {
                card: desc.market_hash_name
            };
            this.log('开始卖卡', 'asset id = ' + asset.assetid, 'class id = ' + asset.classid, desc.market_hash_name);
            try {
                let priceObj = await this.sellCard(asset, desc);
                this.sellSuccLog.push(Object.assign(result, priceObj));
            } catch (err) {
                if (err instanceof Error) {
                    Object.assign(result, { errMsg: err.stack }, err.data);
                } else {
                    Object.assign(result, { errMsg: `未知错误 -- ${this.stringifyJson(err)}` })
                }
                this.sellFailLog.push(result);
            }
            this.log('结束卖卡', 'asset id = ' + asset.assetid, 'class id = ' + asset.classid, desc.market_hash_name);
        }

        async getSoldableCards() {
            let result = await $.getJSON("https://steamcommunity.com/inventory/76561198107132715/753/6?l=schinese");
            let { assets, descriptions } = result;
            descriptions = descriptions.filter(des => {
                if (des.marketable !== 1) {
                    return false;
                }
                if (!des.tags || des.tags.length < 4) {
                    return false;
                }
                if (des.tags[3].internal_name !== "item_class_2" || des.tags[2].internal_name !== "cardborder_0" || des.tags[0].internal_name !== "droprate_0") {
                    return false;
                }
                return true;
            });
            descriptions.forEach((des, i) => {
                this.cardClsIds[des.classid] = i;
            })
            assets = assets.filter(asset => {
                return this.cardClsIds.hasOwnProperty(asset.classid);
            });
            this.assets = assets;
            this.descriptions = descriptions;
        }

        async sellCard(asset, desc) {
            let publisherFee = (typeof desc.market_fee != 'undefined' && desc.market_fee !== null) ? desc.market_fee : g_rgWalletInfo['wallet_publisher_fee_percent_default'];
            if (typeof publisherFee == 'undefined') {
                throw new Error('publisher fee 错误');
            }
            let amount = await this.fetchPrice(desc.market_hash_name);
            let price = this.calSellPrice(amount, publisherFee);
            let priceObj = { lowestPrice: amount, price };
            try {
                await $.getJSON("https://steamcommunity.com/market/pricehistory/", {
                    appid: 753,
                    market_hash_name: desc.market_hash_name
                });
                await this.sleep(2500);
                let ret = await $.post("https://steamcommunity.com/market/sellitem/", {
                    sessionid: g_sessionID,
                    appid: asset.appid,
                    contextid: asset.contextid,
                    assetid: asset.assetid,
                    amount: 1,
                    price
                }, null, 'json');
                if (ret.success && !ret.requires_confirmation) {
                    return priceObj;
                }
                if (ret.success) {
                    this.pause();
                    throw new MyError('需要二次确认, 暂停', Object.assign({}, ret, priceObj));
                }
                throw new MyError(JSON.stringify(ret), priceObj);
            } catch (err) {
                if (err instanceof Error) {
                    if (!err.data) {
                        err.data = priceObj
                    };
                    throw err;
                }
                if (err.status) {
                    throw new MyError(`${err.status} ${err.statusText}`, Object.assign(priceObj, { txt: err.responseText }));
                }
            }
        }

        async fetchPrice(cardHashName) {
            let marketPageUrl = "https://steamcommunity.com/market/listings/753/" + encodeURIComponent(cardHashName);
            let page = await $.get(marketPageUrl);
            page = page.substring(page.lastIndexOf("Market_LoadOrderSpread"));
            let nameId = Number(/Market_LoadOrderSpread\(\s*?(\d+)\s*?\)/.exec(page)[1]);
            if (Number.isNaN(nameId)) {
                throw new Error("nameId 获取失败");
            }
            let result = await $.getJSON("https://steamcommunity.com/market/itemordershistogram", {
                country: "CN",
                language: "schinese",
                currency: 23,
                item_nameid: nameId,
                two_factor: 0
            });
            let { sell_order_graph } = result;
            if (!Array.isArray(sell_order_graph) || !sell_order_graph.length) {
                throw new Error("卡片没有销售记录可供查阅");
            }
            const priceIdx = 0;
            const numIdx = 1;
            let lowestPrice = sell_order_graph[0][priceIdx];
            if (sell_order_graph[0][numIdx] < 10 && sell_order_graph[numIdx]) {
                lowestPrice = sell_order_graph[1][priceIdx]
            }
            return lowestPrice * 100;
        }

        async sleep(ms) {
            return new Promise(resolve => {
                setTimeout(() => {
                    resolve(ms);
                }, ms);
            });
        }

        calSellPrice(lowestPrice, publisherFee) {
            if (lowestPrice <= 1) {
                return 1;
            }
            let price = lowestPrice - 1;
            publisherFee = (typeof publisherFee == 'undefined') ? 0 : publisherFee;
            for (; price > 1; price--) {
                let nSteamFee = parseInt(Math.floor(Math.max(price * parseFloat(g_rgWalletInfo['wallet_fee_percent']), g_rgWalletInfo['wallet_fee_minimum']) + parseInt(g_rgWalletInfo['wallet_fee_base'])));
                let nPublisherFee = parseInt(Math.floor(publisherFee > 0 ? Math.max(price * publisherFee, 1) : 0));
                if (nSteamFee + nPublisherFee + price === lowestPrice) {
                    break;
                }
            }
            return Math.floor(Math.max(price, 2));
        }

        isEmpty(...values) {
            if (!values.length) {
                throw new Error("AutoBot.isEmpty 需要至少一个参数");
            }
            for (let i = 0; i < values.length; i++) {
                switch (typeof values[i]) {
                    case "undefined":
                        return true;
                    case "function":
                        return value === null;
                    case "object":
                        if (Array.isArray(values[i])) {
                            // 直接查询 length
                            return values[i].length === 0;
                        }
                        // 遍历键值
                        return Object.keys(value).length === 0;
                    case "string":
                        return value.length === 0;
                }
            }
        }

        stringifyJson(obj) {
            if (typeof obj == 'string') {
                return obj;
            }
            try {
                let str = JSON.stringify(obj);
                return str;
            } catch (err) {
                return "JSON 序列化错误";
            }
        }

        getTime() {
            let tzoffset = (new Date()).getTimezoneOffset() * 60000;
            return (new Date(Date.now() - tzoffset)).toISOString().slice(0, -1);
        }

        log(...args) {
            console.log(this.getTime(), ...args);
        }
    }

    const bot = new AutoBot();
    window.kxjAutoBot = bot;
    try {
        await bot.init();
    } catch (err) {
        throw err;
    }
})(jQuery);