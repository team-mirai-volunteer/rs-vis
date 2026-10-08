import { pageMetadata } from '@/app/lib/page-metadata';
import FundsView from './view';

export const metadata = pageMetadata('/funds');
export default function Page() { return <FundsView />; }
