// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { WorkbenchRegion } from './WorkbenchRegion'
import { disposeWorkbenchContributions, registerWorkbenchContainer, registerWorkbenchView } from './workbench-contributions'
import { createWorkbenchStore } from './workbench-store'

afterEach(() => {
  cleanup()
  disposeWorkbenchContributions('campaign-fixture')
})

describe('WorkbenchRegion', () => {
  it('stacks every declared overlay and binds each to the current session',()=>{
    const store=createWorkbenchStore();
    const containers=['first','second'].map(id=>({id,location:'overlay' as const,title:id}));
    const views=containers.map(row=>({id:row.id+'.view',container:row.id}));
    for(const container of containers)registerWorkbenchContainer('campaign-fixture',container);
    for(const view of views)registerWorkbenchView('campaign-fixture',{...view,render:ctx=><div>{view.id}:{ctx.sessionId}</div>});
    store.apply({packId:'campaign-fixture',containers,views,layout:{}});
    const view=render(<WorkbenchRegion store={store} location="overlay" sessionId="one"/>);
    expect(view.getByText('first.view:one')).toBeTruthy();expect(view.getByText('second.view:one')).toBeTruthy();
    view.rerender(<WorkbenchRegion store={store} location="overlay" sessionId="two"/>);
    expect(view.getByText('first.view:two')).toBeTruthy();
  });
  it('renders the active form container without knowing its product domain', () => {
    registerWorkbenchContainer('campaign-fixture', {
      id: 'campaign.navigator',
      location: 'primarySidebar',
      title: '战役',
    })
    registerWorkbenchView('campaign-fixture', {
      id: 'campaign.scenes',
      container: 'campaign.navigator',
      render: ({ active }) => <div data-testid="campaign-scenes" data-active={String(active)}>战役 → 场景</div>,
    })
    const store = createWorkbenchStore()
    store.apply({
      packId: 'campaign-fixture',
      containers: [{ id: 'campaign.navigator', location: 'primarySidebar', title: '战役' }],
      views: [{ id: 'campaign.scenes', container: 'campaign.navigator' }],
      layout: { primarySidebar: 'campaign.navigator' },
    })

    const rendered = render(<WorkbenchRegion store={store} location="primarySidebar" />)
    expect(rendered.getByTestId('campaign-scenes').textContent).toBe('战役 → 场景')
    expect(rendered.getByTestId('campaign-scenes').getAttribute('data-active')).toBe('true')
  })
})
