; (async function ($) {
    let container = $('.my_listing_section.market_content_block.market_home_listing_table').eq(1);
    let needConfirmDoms = container.children('[id^=mylisting_]');

    async function sleep(ms) {
        return new Promise(resolve => {
            setTimeout(() => {
                resolve(ms);
            }, ms);
        });
    }

    async function doCancel() {
        for (let i = 0; i < needConfirmDoms.length; i++) {
            let dom = needConfirmDoms.eq(i);
            let itemId = /mylisting_(\d+)/.exec(dom.attr('id'))[1];
            try {
                await $.post('https://steamcommunity.com/market/removelisting/' + itemId, {
                    sessionid: g_sessionID
                }, null, 'json');
            } catch (err) {

            }
            await sleep(Math.floor(Math.random() * 1500 + 2000));
        }
    }
    await doCancel();
})(jQuery);