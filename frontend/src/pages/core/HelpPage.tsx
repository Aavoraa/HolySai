import { useAuth } from '@/auth/AuthContext';
import { Banner, Button, Card, Dl, Grid, Icon, Page, PageHead } from '@/components/ui';

export default function HelpPage() {
  const { user } = useAuth();
  return (
    <Page>
      <PageHead title="Help" sub="How Holy Sai Smart School 360 works." />
      <Grid cols="g-2col">
        <Card title={<span className="row g-2"><Icon name="compass" size={16} />Getting around</span>}>
          <Dl items={[
            ['Find a page', 'Type in “Find a page…” at the top of the sidebar. Esc clears it.'],
            ['Search', 'Ctrl K focuses global search for students, parents, staff, leads and pages.'],
            ['Students', 'Every student name opens the same Student 360 profile.'],
            ['Campus', 'The campus selector in the header scopes every figure in the application.'],
            ['Language', 'Use the language button for English, தமிழ் or हिन्दी.'],
          ]} />
        </Card>
        <Card title={<span className="row g-2"><Icon name="shield" size={16} />Your access</span>}
          foot={<div className="row g-2 wrap"><Button size="sm" icon="user" to="/account">My account</Button><Button size="sm" icon="bell" to="/notifications">Notifications</Button></div>}>
          <p className="t-sm">You are signed in as <strong>{user?.fullName}</strong> ({user?.role.name}). Menus, data and actions follow your role, and the server enforces the same rules on every request.</p>
          <div className="mt-4"><Banner tone="neutral" icon="shield">If you need access to a module you cannot see, ask the school administrator.</Banner></div>
        </Card>
        <Card title={<span className="row g-2"><Icon name="mapPin" size={16} />Student tracking</span>}>
          <p className="t-sm">Locations come from the student's ID-card tag or bus RFID. A location older than 30 minutes is shown as “last known”. Parents see only their own children; every view is audited.</p>
        </Card>
        <Card title={<span className="row g-2"><Icon name="phone" size={16} />Support</span>}>
          <p className="t-sm">Front office: Monday to Saturday, 8:00 am to 5:00 pm. For account or password problems, contact the school office.</p>
        </Card>
      </Grid>
    </Page>
  );
}
