'use client';

import Sidebar from '@/components/Sidebar';
import PageHeader from '@/components/panel/PageHeader';
import CampaignWizard from '@/components/campaigns/CampaignWizard';

/** /campaigns/new — five questions; "Create campaign" draws the sequence and opens it on the canvas. */
export default function NewCampaignPage() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <PageHeader title="New campaign" back={{ href: '/campaigns', label: 'Back to campaigns' }}
          subtitle="Answer five questions and we draw the sequence for you. Every step can still be changed on the canvas." />
        <CampaignWizard />
      </div>
    </div>
  );
}
