// The following line loads the standalone build of Vue instead of the runtime-only build,
// so you don't have to do: import Vue from 'vue/dist/vue'
// This is done with the browser options. For the config, see package.json
import Vue from 'vue'
import App from './App.vue'
import ElementUI from "element-ui"
import 'element-ui/lib/theme-default/index.css'


Vue.use(ElementUI);
new Vue({
  el: '#app',
  render: function(h) {
      return <App></App>;
  }
})
