import { useNavigate } from 'react-router-dom';
import { Button, Empty, Page, PageHead, Card } from '@/components/ui';
import { useAuth } from '@/auth/AuthContext';

export default function NotFoundPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  return (
    <Page>
      <PageHead title="Screen not found" sub="This address is not part of Holy Sai Smart School 360." crumbs={false} />
      <Card>
        <Empty
          icon="compass"
          title="We couldn't find that page"
          sub="The link may be out of date, or the page may not be part of your role. Use the menu, search with Ctrl K, or return to your dashboard."
          action={
            <div className="row g-2 wrap center">
              <Button icon="arrowLeft" onClick={() => navigate(-1)}>Go back</Button>
              <Button variant="primary" icon="home" to={user?.role.homeRoute ?? '/'}>Go to dashboard</Button>
            </div>
          }
        />
      </Card>
    </Page>
  );
}
