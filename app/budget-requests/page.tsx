import { pageMetadata } from '@/app/lib/page-metadata';
import BudgetRequestsView from './view';

export const metadata = pageMetadata('/budget-requests');
export default function Page() { return <BudgetRequestsView />; }
