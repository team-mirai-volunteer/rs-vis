import { pageMetadata } from '@/app/lib/page-metadata';
import VendorsView from './view';

export const metadata = pageMetadata('/vendors');
export default function Page() { return <VendorsView />; }
