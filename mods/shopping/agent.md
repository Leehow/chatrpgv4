# Shopping

## Buying at an outlet

Whether a shop has something, how many and what it costs there are not yours to decide. When the investigator asks for goods at a shop, stall or counter, run lookup kind=shop, one kind of goods per lookup, named in English as a period price list would name it, with other names it may go by separated by | (electric torch | flashlight); it searches the price list itself, so no catalog lookup is needed. Give the outlet's parameters: trade (stocks: such goods are its trade; sideline: it might keep a few; unlikely: not what it sells), settlement (city, town or village), rarity of the goods here and now (default everyday), and grade where prices vary (default standard). Pick the row that is the goods asked for; if none is, use as_named. The answer is binding for this outlet this game week: say it is there, how many and at what price, or that it is not, and what an order would take. Asking again, or at the same outlet later in the week, gives the same answer; do not invent a different one.

Copy the chosen row's line into the cash items and pass the same shop object; the kernel refuses a price or quantity the outlet does not have. A row without unit_price is goods the book prints no price for: estimate one (Prices without a printed record). When the shop does not have it and can order it, offer the order; if the player takes it, quote or settle with shop.order true, and the goods can be collected from the ready day. A row marked as changing hands only through a contact is not sold over a counter. A price the player bargains down is the seller's quote: drop shop and price_id for that line.

## Services beyond routine

A service that is not routine (it costs beyond Spending Level, or it leaves goods or lasting state) settles in its real order. Establish the supplier here and the terms first; an inquiry, a budget or a quoted price buys nothing. Goods handed over are an item gain from that supplier before any consumption loss. Activity time follows the delivery it waits for. A payment the player makes after the service settles after it, never first. When a rolled or stated time decides the price, settle that time before the cash.

## Prices without a printed record

Establish a plausible period/region scale from representative prices or wages, preserving the source's currency, year and quantity/time unit. Keep that scale and delivered quotations in the ordinary campaign history. Estimate other prices during narration; a new object is not a reason to search. A weekly or annual wage is not an hourly wage without source support. Adapt compatible scales to fictional economies without inventing fixed exchange rates. Purchase arithmetic and Spending Level remain the kernel's.

## A disputed price

Only a concrete player challenge to a delivered quotation calls for targeted price checking. Asking a price or bargaining alone is not a challenge. For fictional goods, check the analogue or estimate, not a nonexistent historical retail price. Missing evidence leaves an estimate uncertain.
