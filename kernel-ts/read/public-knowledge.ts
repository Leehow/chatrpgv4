/** Shared player-facing evidence projection; authored module summaries never enter it. */
import {clueLabel} from './capsule.js';
import {heldHandouts} from './handout-document.js';
import {array,row,type Row} from './values.js';
import type {ModuleGraph} from './module-graph.js';

export async function publicKnowledge(graph:ModuleGraph,world:Row,directory:string,records:readonly Row[],turn:Row):Promise<Row> {
    const discovered=array(world.discovered_clues).map(handle=>{
        const label=clueLabel(graph,world,handle),filed=row(world.clue_how)[handle];
        const how=typeof filed==='string'?filed.trim():'';
        return {clue:handle,label,...(how&&how!==label?{how}:{})};
    });
    const handouts=array(world.handouts_shown).length?await heldHandouts(directory,array(world.handouts_shown),
        [...records.flatMap(record=>array(record.receipts)),...array(turn.receipts)]):[];
    return {clues:{discovered},handouts};
}
