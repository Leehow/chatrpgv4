// Preserve production extension order while substituting only the deterministic final author.
// Tests through this wrapper are protocol/state regression evidence, never live-play evidence.
import kernelExtension from '../../../extensions/kernel/index.ts';
import {ownedOutputProvider} from './owned-output-provider.mjs';
export default pi => kernelExtension(pi,{capabilities:ownedOutputProvider});
