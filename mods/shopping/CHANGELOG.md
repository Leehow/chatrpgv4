# Shopping

## 1.0.0

- New optional package (contract §265, owner 2026-10-24): purchases have one home. `lookup kind=shop` answers from the Keeper's outlet parameters whether the goods are on the shelf this game week, how many, the outlet's price and how long an order takes; cash lines carrying the same `shop` object are checked against it, a sale takes stock off the shelf and an order is collected from its ready day. Requires `shopping.stock.v1`.
- Collects the purchase guidance that lived in other packages: `Services beyond routine` from Quick Settlement 1.2.1 (now 1.3.0), and `Prices` (renamed `Prices without a printed record`) and `A disputed price` from Historical Reference 1.3.0 (now 1.4.0). Their text is unchanged.
