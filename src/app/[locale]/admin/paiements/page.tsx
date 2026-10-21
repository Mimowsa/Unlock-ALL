import {Admin} from '@/features/administration/admin';import {ProtectedDemoPage} from '@/components/protected-demo-page';
export default async function Page({params}:{params:Promise<{locale:string}>}){const {locale}=await params;return <ProtectedDemoPage locale={locale} admin next="admin"><Admin section="paiements"/></ProtectedDemoPage>;}
