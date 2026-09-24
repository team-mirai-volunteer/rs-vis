import { pageMetadata } from '@/app/lib/page-metadata';
import TaxExpenditures from './view';

export const metadata = pageMetadata('/tax-expenditures');
export default function Page() { return <TaxExpenditures />; }
