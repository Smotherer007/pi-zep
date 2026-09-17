/**
 * Trimmed capture of the Einplanung chart snippet.
 *
 * Captured live from zep-online.de (Mandant zepneoimpulse, ZEP v7.13.88) on
 * 2026-09-17 and reduced to four columns. Only the shape is real - the chart
 * options object sitting inside an ajax schnipsel's HTML, JavaScript formatter
 * functions included, which is why it is not plain JSON. Project names and
 * numbers are fictional.
 */
export const PLAN_CHART_SNIPPET = `<div class="card bg-light" id="card_1"><div class="card-body bg-white rounded-bottom">
            <div id="chartchart1"></div>
            <script type="text/javascript">
                var optionschart1 = {"series":[{"name":"Verf\\u00fcgbarkeit [19,20 h]","type":"area","data":[6.4000000000000004,6.4000000000000004,0,6.4000000000000004]},{"name":"K-10000-00002 (Example Corp - Extensions 2026) [12,00 h]","type":"bar","data":[8,4,0,0]},{"name":"K-10000-00003 (Example Corp - Improvements Q3\\/Q4 2026) [9,60 h]","type":"bar","data":[3.2000000000000002,3.2000000000000002,0,3.2000000000000002]},{"name":"K-10000-00001 (Contoso - Integration Warehouse Automation in SAP S\\/4 Cloud Public Edition) [1,60 h]","type":"bar","data":[1.6000000000000001,0,0,0]},{"name":"gesamt [23,20 h]","type":"line","data":[12.8,7.2000000000000002,0,3.2000000000000002]}],"chart":{"type":"line","height":250,"locales":[apex_lang_de],"defaultLocale":"de","zoom":{"enabled":false},"toolbar":{"show":false},"stacked":true,"animations":{"enabled":false}},"xaxis":{"tooltip":{"enabled":false},"categories":["Heute","Morgen","19.09.","20.09."]},"legend":{"show":true,"position":"right"},"states":{"hover":{"filter":{"type":"darken","value":0.90000000000000002}}},"stroke":{"curve":"smooth","width":2},"title":{"text":"Patrick Weppelmann","align":"left"},"subtitle":{"text":"17.09.2026-17.10.2026","align":"left"},"colors":["#ebebeb","#CC6B1D","#f1c40f","#F3753F","#ff0000"],"yaxis":{"title":{"text":"Stunden"},"labels":{"formatter":function(val, index) { if (val !== "undefined") { return Number.parseFloat(val).toFixed(0); } return val; }}},"tooltip":{"shared":true,"x":{"show":true},"y":{"formatter":function(val, index) { if (val !== 'undefined') { return Number.parseFloat(val).toFixed(2)+' h'; } return val; }}}};
                var chartchart1 = new ApexCharts(document.querySelector("#chartchart1"), optionschart1);
                chartchart1.render();
            </script></div></div>`;
