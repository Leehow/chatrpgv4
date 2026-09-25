# SL-29 book A — player script (血色公路, zh-Hans, investigator 雷·卡特 made in the live setup session), 20 turns

Derived from the module's graph as built at campaign creation (generation 2, 4 nodes): the entrance scene 序幕
(its dramatic question "continue or turn back", the radio, the billboard "5 英里后右转", the fork sign
"3 英里后抵达阿巴托尔 / 提供汽油和食品", exit by the dirt road), the keeper-only rule 回头或继续，下场一样,
and the route to 欢迎来到"屠宰场" (hills, a sharp bend, an old wooden bridge, the town's edge; the town itself unread).
The graph carries no people, obligations or checks yet: everything past the town's edge is what the product has to
read on demand, and the sentences there are this investigator's own business (a private investigator from Houston
looking for a client's missing daughter), asked the way a player who has not read the book would ask. No sentence
names a place, person or fact from the book beyond the graph above.

One sentence per turn, in order. Between turns the turn record is read only to pick a marked branch, by structure:
`present(n)` = the kernel's `world.present` after turn n is non-empty; `moved(n)` = `world.scene.name` after turn n
differs from after turn n-1; `hurt(n)` = a `change` mechanic on `hp` for the investigator with after < before, or a
combat `session` mechanic, in turn n.

1. 我继续往前开，盯着油表，留意路边有没有加油站的牌子。
2. 我把收音机开大一点听听，再摊开地图看看这条路前面通到哪里。
3. 看到那块写着五英里后右转的小牌，我减速，记下里程表的数字。
4. 到了土路口我停车看了看那两块木头路标，然后拐上土路，往阿巴托尔开。
5. 过那座旧木桥之前我先下车，看看桥板和桥桩结不结实。
6. 到了镇口，我把车停在路边先不下车，看看镇子的样子，有没有人在外面。
7. 我开车去找能加油的地方，路标上说这里有汽油。
8. [if present(7)] 我下车跟对方打招呼，说要把油加满，再问附近哪里能吃饭。 / [else] 我下车按了两下喇叭，喊一声有没有人能加油。
9. 等加油的时候，我拿出那个姑娘的照片，问这个月有没有见过她路过这里。
10. 我留意对方回答时的眼神和手，看他是不是在说谎。
11. 我付了钱，顺便问镇上有没有能住一晚的地方，管事的警长或者镇长在哪。
12. 我把车开进镇里，沿着主街慢慢开一遍，看看都有些什么店。
13. [if moved(12)] 我在最近的一家店门口停车，进去买两瓶水和一点吃的。 / [else] 我把车停在路边，下车沿着街走一遍。
14. 我跟店里的人聊聊天气和生意，然后拿照片问那个姑娘。
15. 我去找镇上管事的人，问最近有没有外地人来过、有没有人报过失踪。
16. 我找个能看见主街的地方坐一会儿，留意有没有人在盯着我。
17. [if hurt(16)] 我往皮卡那边退，手按着左轮，不先开枪。 / [else] 我去找个能吃饭的地方，边吃边听旁边的人聊什么。
18. [if present(17)] 我请旁边的人喝一杯，问他镇上的人为什么都不怎么出门。 / [else] 我问端菜的人，镇上晚上都干些什么。
19. 我回到皮卡上，把今天问到的都记在本子上，再看看地图。
20. [if hurt in any turn 15–19] 我发动皮卡，掉头往大路上开。 / [else] 我去能住的地方要一间房，顺便问老板这姑娘有没有在这住过。
