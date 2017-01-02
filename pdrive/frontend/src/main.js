// The following line loads the standalone build of Vue instead of the runtime-only build,
// so you don't have to do: import Vue from 'vue/dist/vue'
// This is done with the browser options. For the config, see package.json
import Vue from 'vue'
import App from './App.vue'
import ElementUI from "element-ui"
import 'element-ui/lib/theme-default/index.css'


Vue.use(ElementUI);
Vue.directive('elfocus', {
    bind: function (el) {
        Vue.nextTick(function() {
            el.getElementsByTagName("input")[0].focus();
        });
    }
});
new Vue({ // eslint-disable-line no-new
  el: '#app',
  render: (h) => h(App)
})
