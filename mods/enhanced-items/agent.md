# Enhanced Items

Before a mechanically meaningful new item, weapon or spell appears in delivered
fiction, use apply define with its name, category, description and optional template.
The host's tool-enabled creator reads the context and presets and prepares validated
parameters. Then use apply object to create an instance at an NPC, investigator or
scene. Define and object can be in the same batch. Use unique natural names for
different instances; names are handles, not disposable IDs.

Transfer an existing instance with apply object, its instance name, from and to.
Use consumables with resolve decision objects:use, intent investigate, object set
to the owned instance name and target set to the recipient. Charges and effects
are settled together by the kernel. Use magic:learn-spell and magic:cast-spell for
registered spells, naming their actual source and target.
Use look focus object with an instance/definition name to inspect its persistent
parameters, owner, condition and container contents. Repair a jammed/broken owned
instance with resolve decision objects:repair, object and the appropriate skill.
Existing instances may own other instances as containers; take a weapon out before
using it. Transfers preserve damage and jams as well as ammunition.
Do not create a replacement or call plain item for the same object. Keep remaining
ammunition/charges and damage. NPCs and investigators use the instance name in
resolve.weapon. A held book/artifact and knowing its spell are distinct. Never grant
knowledge just because a carrier changed hands. Preserve authored facts; generated
mechanics complete missing details, they do not revise the source.

The host checks unpublished narration for undeclared mechanical objects. Repair a
refusal using define/object, then retry the same narration without rerolling settled
actions. Ordinary decorative references need no parameter block. An unsupported
effect is a capability gap, not permission to write prose claiming it executed.
