import {refreshDeepSeekCatalog} from './catalog-runtime.js';
import {createDeepSeekProvider, DEEPSEEK_PROVIDER_ID} from './provider.js';
export * from './provider.js';
export default function (pi) {
    pi.registerProvider(DEEPSEEK_PROVIDER_ID, createDeepSeekProvider());
    // Request policy is inside the shared stream, including host and child callers.
    void refreshDeepSeekCatalog();
}
