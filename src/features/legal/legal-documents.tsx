import type { ReactNode } from "react";
import Link from "next/link";

export type LegalDocument = {
  title: string;
  path: "/privacy" | "/terms";
  introduction: string;
  summary: string[];
  reviewNotes: string[];
  sections: { id: string; title: string; content: ReactNode }[];
};

export function LegalContact() {
  return <a href="mailto:info@bizgroup.ae">info@bizgroup.ae</a>;
}

// Drafts reflect the current application, not an audit of vendor contracts.
// Before making them effective, resolve the review notes, verify every policy
// commitment with the business, and remove the draft notice and noindex metadata.
export const privacyPolicy: LegalDocument = {
  title: "Privacy Policy",
  path: "/privacy",
  introduction:
    "How information moves through Fabric, why we use it, and the choices available to you.",
  summary: [
    "Fabric turns workplace conversations into process knowledge, maps, and insights.",
    "Recordings and transcripts can contain personal information. Your organisation manages access to its workspace.",
    "Contact Biz Group with privacy questions or requests at info@bizgroup.ae.",
  ],
  reviewNotes: [
    "Confirm Biz Group’s full registered legal name, postal address, and any required privacy representative or data protection officer.",
    "Verify vendor agreements, the complete subprocessor list, processing countries, international transfer safeguards, and vendor retention and model-training settings. The application has no model-training workflow; that alone does not establish a provider’s training policy.",
    "Approve retention periods for recordings, transcripts, generated knowledge, account records, logs, and backups, including how deletion propagates to providers and derived outputs.",
    "Confirm applicable UAE, free-zone, and overseas privacy regimes, lawful grounds for each purpose, and the operational process for rights requests and complaints.",
    "Validate the cookie and storage inventory, any consent requirements, marketing practices, and the effective date before publication as an approved policy.",
    "Confirm the AI assistant connection (MCP) wording against the assistant providers customers are likely to use, and whether customers should be pointed to those providers’ data terms.",
  ],
  sections: [
    {
      id: "who-we-are", title: "Who we are and what this covers",
      content: <>
        <p>Fabric is operated by Biz Group, based in Dubai, United Arab Emirates (referred to as “Biz Group,” “we,” “us,” or “our”). This policy covers personal information handled through bizfabric.ai, Fabric organisation workspaces, and related communications with us.</p>
        <p>Fabric helps organisations capture knowledge through AI-guided interviews, direct voice recordings, and uploaded audio, and turn that material into transcripts, summaries, process maps, and operational insights.</p>
        <p>For website enquiries, account administration, and our own business operations, Biz Group determines why and how personal information is used. When we process workplace content on behalf of a customer organisation, we act under that organisation’s instructions and applicable service and data-processing agreements. Your organisation is responsible for its own employee and contributor privacy notices.</p>
      </>,
    },
    {
      id: "information-we-handle", title: "Information we handle",
      content: <>
        <ul>
          <li><strong>Account and organisation information.</strong> Name, email address, user identifiers, organisation membership, role, invitations, and authentication information managed through our sign-in provider.</li>
          <li><strong>Conversations and recordings.</strong> Audio you record or upload, AI interview conversations, transcripts, speaker or contributor information, timestamps, conversation titles, and processing status.</li>
          <li><strong>Workplace knowledge.</strong> Process descriptions, departments, functions, tools, responsibilities, handoffs, feedback, and other information you or your organisation enter, together with generated summaries, maps, and insights.</li>
          <li><strong>Technical and usage information.</strong> Request and device information available to our infrastructure, error and security logs, feature activity, processing metadata, and AI usage records used to operate and administer the service.</li>
          <li><strong>Communications.</strong> Information you send when asking about Fabric, requesting a demonstration, seeking support, or making a privacy request.</li>
        </ul>
        <p>Conversations may include information about colleagues, customers, suppliers, or other people. Submit only information you are authorised to share. Avoid unnecessary sensitive information, passwords, payment card details, and confidential material outside the agreed scope of your organisation’s use.</p>
      </>,
    },
    {
      id: "sources", title: "Where information comes from",
      content: <>
        <p>We receive information directly from you, from your organisation and its administrators or contributors, from authentication services, and from your use of the website and application. We also generate information by transcribing and analysing content submitted to Fabric.</p>
        <p>You may be mentioned in a recording or transcript submitted by someone else even if you do not have a Fabric account. Your organisation should explain its recording and knowledge-capture activities to participants and obtain any required permissions.</p>
      </>,
    },
    {
      id: "purposes", title: "How and why we use information",
      content: <>
        <ul>
          <li>Provide sign-in, invitations, workspace membership, and role-based access.</li>
          <li>Conduct AI interviews, store and transcribe audio, and generate or update process knowledge, maps, and insights.</li>
          <li>Make content available to authorised people within the customer organisation.</li>
          <li>Track processing and usage, diagnose failures, maintain service reliability, and support customers.</li>
          <li>Protect accounts and workspaces, investigate misuse, and enforce applicable service agreements.</li>
          <li>Respond to enquiries and requests, administer customer relationships, and meet legal obligations.</li>
        </ul>
        <p>Depending on the applicable law and context, processing may rely on consent, performance of a contract, compliance with legal obligations, or another ground permitted by law. Where a law permits reliance on legitimate interests, those interests include service security, reliability, and customer administration, subject to the protections that law requires. Workplace content is processed on the customer organisation’s instructions; that organisation is responsible for establishing the lawful grounds for its collection and use.</p>
        <p>Information needed for authentication and workspace processing is necessary to provide those features. If it is not supplied, the relevant feature may be unavailable. Optional enquiries and additional content are your choice.</p>
      </>,
    },
    {
      id: "audio-and-ai", title: "Voice recordings and AI processing",
      content: <>
        <p>When you start a voice feature, Fabric requests microphone access through your browser. Existing audio can also be uploaded. Recordings and interview content are processed by voice and transcription services; transcripts and relevant workplace context are sent to AI services to produce the results requested by your organisation.</p>
        <p>Fabric currently uses ElevenLabs for voice interviews and transcription, and Microsoft Foundry for AI analysis and generation, with model deployments from Anthropic and OpenAI. The information sent depends on the feature used and can include personal information contained in the source material.</p>
        <p>AI output can be incomplete or inaccurate. Fabric’s outputs support organisational review; they should not be treated as verified facts about a person or as the sole basis for decisions with legal or similarly significant effects. Review the underlying evidence and correct errors before acting on a result.</p>
        <p>Processing content to generate an answer is distinct from training an AI model. Provider retention and any use of data for model improvement depend on the applicable provider agreement and configuration. Contact us for information about the arrangements applicable to your organisation.</p>
      </>,
    },
    {
      id: "sharing", title: "Who can receive information",
      content: <>
        <p>Information may be available to your organisation’s authorised users and administrators according to their workspace permissions. Administrators manage membership and can review or manage organisation content. Fabric is a workplace knowledge service, so contributions should not be assumed to be private from your organisation.</p>
        <p>We use service providers to deliver the application, including Clerk for authentication and organisation membership, Convex for application data and file storage, ElevenLabs for voice and transcription, and Microsoft Foundry for AI processing. Hosting, infrastructure, and support providers may also process information needed for their services.</p>
        <p>If your organisation has added Fabric’s AI assistant connection (Model Context Protocol, or MCP) and an administrator has switched it on, members can connect AI assistants that support MCP to the workspace. An assistant receives the workspace information that member is permitted to see, when the member asks it something, and the assistant’s provider then handles that information under its own terms. Your organisation chooses which assistants are used.</p>
        <p>Authorised Biz Group personnel and professional advisers may access information where needed for support, administration, security, or legal matters. We may disclose information when required by law, to respond to lawful requests, or to protect rights and safety. Information may also be transferred in connection with a merger, acquisition, or business transfer, subject to applicable privacy requirements.</p>
        <p>This policy covers Fabric’s handling of information. Third-party sites you visit through external links have their own privacy practices.</p>
      </>,
    },
    {
      id: "cookies", title: "Cookies and browser storage",
      content: <>
        <p>Fabric and its authentication services use cookies and similar technologies to support sign-in, session security, and service operation. The application also uses local and session storage for preferences such as theme, navigation, view settings, and whether you skipped the welcome tour.</p>
        <p>If you install Fabric as a web app, a service worker can cache static assets to support the installed experience. This browser storage is separate from the recordings, transcripts, and workspace data maintained by the service.</p>
        <p>You can manage cookies, site data, and microphone permissions in your browser settings. Blocking or clearing necessary storage may sign you out, reset preferences, or prevent features from working. Any optional tracking that requires consent must be handled through an appropriate consent mechanism before it is used.</p>
      </>,
    },
    {
      id: "international-processing", title: "International processing",
      content: <>
        <p>Biz Group is based in the UAE. Our service providers may process or store information in other countries depending on their infrastructure and the configuration used for your organisation. Do not assume that using Fabric means all information remains in the UAE. Information read by an AI assistant your organisation connects to Fabric is processed wherever that assistant’s provider operates, which may differ from where Fabric processes it.</p>
        <p>International transfers must comply with the requirements of applicable law and the relevant customer and provider agreements. Contact us for details of processing locations and any transfer safeguards applicable to your organisation.</p>
      </>,
    },
    {
      id: "retention", title: "Retention and deletion",
      content: <>
        <p>Retention depends on the type of information, the purpose for which it is held, the organisation’s instructions and service agreement, and any legal or security requirements. Workplace content is kept to provide the organisation’s knowledge workspace unless deleted or otherwise addressed under its agreement. Account, support, usage, and security records may be kept for administration, troubleshooting, dispute resolution, or legal obligations. When the AI assistant connection is used, Fabric keeps a record of each request (when, by whom, through which assistant and which tool, never the question or answer) for 90 days; daily totals without names are kept as billing records.</p>
        <p>Authorised administrators can delete conversations in Fabric. Deleting a conversation should not be assumed to immediately remove every related summary, process map, backup, or provider-held copy. Derived knowledge and provider records can have separate lifecycles and may require additional action.</p>
        <p>For a deletion or retention request, contact your organisation’s administrator or <LegalContact />. We will assess the request against applicable law, the organisation’s instructions, and any information we must retain.</p>
      </>,
    },
    {
      id: "security", title: "How information is protected",
      content: <>
        <p>Fabric uses authentication, organisation-scoped access checks, role permissions, and controlled access to recordings to limit access to workspace information. Security also depends on how your organisation assigns roles and how you protect your account and devices.</p>
        <p>No online service can guarantee absolute security. Report suspected unauthorised access or a security concern promptly to your organisation’s administrator and <LegalContact />.</p>
      </>,
    },
    {
      id: "rights", title: "Your choices and privacy rights",
      content: <>
        <p>Depending on the law that applies to you, you may have rights to obtain information about processing, access or receive a copy of your information, correct inaccuracies, request deletion, restrict processing, transfer information, or object to certain uses. Where processing depends on consent, you may withdraw that consent; withdrawal does not change the lawfulness of earlier processing.</p>
        <p><strong>Right to object:</strong> where applicable law grants this right, you can object to processing based on legitimate interests and to use of your information for direct marketing.</p>
        <p>Send requests to <LegalContact />. Identify your organisation and describe the request, but do not send passwords or unnecessary sensitive information. We may need to verify your identity. If the request concerns content controlled by your organisation, we may refer it to the organisation or assist it in responding. Rights can be subject to legal conditions and exceptions.</p>
        <p>You may also complain to the data protection authority with jurisdiction over your circumstances. Contacting us first does not remove that right.</p>
      </>,
    },
    {
      id: "children", title: "Children and workplace use",
      content: <p>Fabric is intended for use by organisations and their authorised workplace contributors. It is not designed as a service for children. If you believe a child’s information has been submitted without appropriate authorisation, contact <LegalContact /> so the matter can be assessed with the relevant organisation.</p>,
    },
    {
      id: "changes-and-contact", title: "Changes and contact",
      content: <>
        <p>We may update this policy as Fabric, our practices, or legal requirements change. An approved policy will display its effective or updated date, and material changes will be communicated as required by law or the applicable customer agreement.</p>
        <p>For privacy questions or requests, contact Biz Group, Dubai, United Arab Emirates, at <LegalContact />.</p>
      </>,
    },
  ],
};

export const termsOfUse: LegalDocument = {
  title: "Terms of Use",
  path: "/terms",
  introduction:
    "The terms for using Fabric’s website and platform to capture, understand, and improve how work happens.",
  summary: [
    "Use Fabric only with your organisation’s authorisation and the permissions needed for your content.",
    "Your organisation retains its content. Review AI-generated outputs before relying on them.",
    "A separate customer agreement governs any agreed fees, service commitments, and commercial terms.",
  ],
  reviewNotes: [
    "Confirm the full contracting entity and address, minimum age or eligibility policy, and how these terms are accepted by website visitors and workspace users.",
    "Approve the content licence, output ownership language, confidentiality commitments, and order of precedence against customer and data-processing agreements.",
    "Set any default commercial rules for trials, fees, renewals, cancellation, refunds, and post-termination export or deletion. This draft defers them to customer agreements.",
    "Approve warranty exclusions, liability limitations or caps, any indemnities, suspension procedures, and the proposed UAE governing law and Dubai court jurisdiction.",
    "Set the effective date and change-notification or reacceptance process before activating these terms.",
  ],
  sections: [
    {
      id: "scope", title: "About these terms",
      content: <>
        <p>These Terms of Use govern access to bizfabric.ai and the Fabric platform provided by Biz Group, Dubai, United Arab Emirates (“Biz Group,” “we,” “us,” or “our”). “You” means the person using the service and, where that person has authority to act for an organisation, that organisation.</p>
        <p>When these terms become effective, accessing or using Fabric constitutes agreement to them to the extent permitted by applicable law. If you do not agree, do not use the service. A person acting for an organisation must have authority to accept obligations on its behalf.</p>
        <p>If your organisation has a separate written service agreement, order form, or data-processing agreement with Biz Group, that agreement governs its subject matter and prevails over these terms where they conflict. These terms do not replace negotiated customer commitments.</p>
      </>,
    },
    {
      id: "service", title: "What Fabric provides",
      content: <>
        <p>Fabric captures workplace knowledge through AI-guided interviews, direct recordings, and audio uploads. It uses transcription and AI processing to create summaries, process knowledge, maps, and operational insights for review by the organisation.</p>
        <p>Features depend on workspace configuration, permissions, and available third-party services. We may maintain, update, or change the service, subject to any commitments in your organisation’s agreement. Demonstrations and preview features illustrate capabilities and are not promises of a particular outcome. Optional add-ons, such as connecting AI assistants to a workspace (MCP), are available where included in your organisation’s agreement.</p>
      </>,
    },
    {
      id: "eligibility", title: "Eligibility, accounts, and organisations",
      content: <>
        <p>You must have legal capacity to use the service and be authorised to access the relevant organisation’s workspace. Fabric is intended for workplace use and is not designed for children.</p>
        <p>Keep your account information accurate, protect authentication credentials and devices, and do not share access in a way that bypasses assigned permissions. Notify your administrator and Biz Group promptly if you suspect unauthorised access.</p>
        <p>Organisation administrators manage membership and roles. Your access can change or end when your organisation changes your permissions. You are responsible for activity you authorise through your account, subject to applicable law.</p>
      </>,
    },
    {
      id: "recording-permissions", title: "Permission to record and submit content",
      content: <>
        <p>Before recording, interviewing, uploading audio, or submitting workplace information, obtain all notices, permissions, consents, and other authorisations required by law and your organisation’s policies. Browser microphone permission alone does not establish permission to record other people.</p>
        <p>You and your organisation are responsible for having the rights to submit content and authorise its processing through Fabric and the providers used to deliver the service. Do not upload someone else’s confidential information or unnecessary sensitive personal information without appropriate authorisation.</p>
        <p>Your organisation should explain who can access contributions and how the resulting knowledge will be used. Contributors should understand that recordings, transcripts, and generated knowledge can be visible to authorised organisation users and administrators.</p>
      </>,
    },
    {
      id: "acceptable-use", title: "Acceptable use",
      content: <>
        <p>Use Fabric lawfully and within the scope of your organisation’s authorisation. You must not:</p>
        <ul>
          <li>Submit unlawful, infringing, deceptive, abusive, or malicious content.</li>
          <li>Use the service for unauthorised surveillance, impersonation, or recording without required permissions.</li>
          <li>Access another organisation’s information, evade access controls, or misuse invitations or credentials.</li>
          <li>Disrupt the service, introduce malware, probe for vulnerabilities without authorisation, or bypass usage restrictions.</li>
          <li>Extract information through unauthorised scraping or use the service to infringe privacy, intellectual property, or other rights.</li>
          <li>Use an AI assistant connection to get around workspace permissions, or to copy workspace content in bulk beyond what your organisation has authorised. Fabric limits request rates and may suspend a connection that is misused.</li>
          <li>Treat AI results as the sole basis for consequential decisions about individuals without appropriate verification and lawful safeguards.</li>
        </ul>
      </>,
    },
    {
      id: "content", title: "Your content and our processing permission",
      content: <>
        <p>You or your organisation retain rights in the recordings, transcripts, documents, process descriptions, and other material submitted to Fabric (“Customer Content”). These terms do not transfer ownership of that content to Biz Group.</p>
        <p>You grant Biz Group permission to host, store, reproduce, transcribe, analyse, transform, and display Customer Content, and to allow service providers to do so, to the extent needed to provide, secure, support, and administer Fabric under the applicable customer agreement. This includes creating the summaries, maps, and insights requested by your organisation.</p>
        <p>This permission is limited to those purposes and any other use you separately authorise. It does not give Biz Group a general right to publish your private workplace content. Retention and deletion remain subject to the customer agreement, the Privacy Policy, and applicable law.</p>
      </>,
    },
    {
      id: "outputs", title: "AI outputs and human review",
      content: <>
        <p>AI-generated transcripts, summaries, maps, and recommendations may be inaccurate, incomplete, or unsuitable for a particular decision. They can reflect errors or omissions in source material. Check outputs against the underlying evidence and obtain appropriate professional advice when necessary.</p>
        <p>As between Biz Group and the customer organisation, and to the extent permitted by law and applicable third-party rights, the organisation may use the outputs produced from its Customer Content for its business purposes. Biz Group does not claim ownership of the organisation’s underlying content. AI outputs may not be unique or eligible for intellectual property protection.</p>
        <p>Fabric does not guarantee business improvements, regulatory compliance, or the accuracy of statements about individuals. Your organisation remains responsible for decisions made using the service.</p>
        <p>Answers from an AI assistant connected to Fabric are produced by that assistant, not by Fabric, even when they cite Fabric content. Check them against the linked Fabric pages before relying on them.</p>
      </>,
    },
    {
      id: "our-property", title: "Fabric’s intellectual property",
      content: <>
        <p>Biz Group and its licensors retain rights in Fabric’s software, design, branding, documentation, and service technology, excluding Customer Content and rights expressly granted to you. You receive a limited permission to use the service as authorised under these terms and your organisation’s agreement.</p>
        <p>Do not copy, resell, sublicense, or reverse engineer the service except where an agreement or applicable law permits it. If you voluntarily provide product feedback, we may use it to improve Fabric without an obligation to compensate you; do not include confidential information in feedback unless agreed.</p>
      </>,
    },
    {
      id: "privacy", title: "Privacy and confidential information",
      content: <>
        <p>Our <Link href="/privacy">Privacy Policy</Link> describes the information Fabric handles, the providers involved, and how privacy requests can be made. Data-processing and confidentiality obligations in your organisation’s written agreement remain applicable.</p>
        <p>Respect the confidentiality of information available in your workspace. Share or export it only as authorised by your organisation and applicable law. Workspace permissions do not, by themselves, grant permission to disclose information outside the organisation.</p>
      </>,
    },
    {
      id: "third-parties", title: "Third-party services",
      content: <>
        <p>Fabric relies on third-party authentication, hosting, storage, voice, transcription, and AI services. Their availability or technical limits can affect Fabric. Separate terms may apply if you directly use a third-party service or follow an external link.</p>
        <p>Any commitments Biz Group makes about third-party processing or service availability are governed by the applicable written customer agreement. An external link does not imply endorsement of the linked service.</p>
        <p>If your organisation connects AI assistants to Fabric, it does so by its own choice and under that assistant’s terms. Biz Group isn’t responsible for how an assistant’s provider processes, stores, or uses information it reads from Fabric, or for the assistant’s answers. The administrator who switches the connection on accepts these terms on behalf of the organisation.</p>
      </>,
    },
    {
      id: "commercial-terms", title: "Fees, trials, and cancellation",
      content: <>
        <p>Any fees, payment terms, usage allowances, trial conditions, renewal arrangements, cancellation rights, and refund rules are set out in the relevant order form or written customer agreement. These terms do not establish an automatic renewal, a general refund entitlement, or a separate online purchasing arrangement.</p>
        <p>Contact <LegalContact /> with commercial questions or requests relating to your organisation’s account.</p>
      </>,
    },
    {
      id: "suspension", title: "Suspension and ending access",
      content: <>
        <p>Subject to applicable law and the customer agreement, we may restrict or suspend access where reasonably necessary to address misuse, unauthorised access, a security risk, a legal requirement, or a material breach. Where appropriate, we will explain the reason and give an opportunity to resolve the issue; urgent situations may require immediate action.</p>
        <p>Your organisation may also remove your membership or change your role. Ending access does not automatically delete the organisation’s content. Export, retention, deletion, and any transition assistance are governed by its agreement and the Privacy Policy. Arrange any needed exports with your administrator before access ends.</p>
      </>,
    },
    {
      id: "warranties-and-liability", title: "Warranties and liability",
      content: <>
        <p>Except for express commitments in a written customer agreement and rights that cannot lawfully be excluded, Fabric and its outputs are provided on an “as is” and “as available” basis. To the extent permitted by law, we do not provide implied warranties of merchantability, fitness for a particular purpose, or non-infringement, or promise uninterrupted or error-free operation.</p>
        <p>To the extent permitted by applicable law and subject to the customer agreement, Biz Group is not liable for indirect or consequential loss, loss of profits, or loss of business opportunities arising from use of the service. Any agreed financial liability cap and other allocation of liability are governed by the written customer agreement.</p>
        <p>Nothing in these terms excludes liability for fraud or any other liability or statutory right that applicable law does not allow to be excluded or limited.</p>
      </>,
    },
    {
      id: "disputes", title: "Governing law and resolving disputes",
      content: <>
        <p>Unless your organisation’s written agreement states otherwise, these terms are governed by the laws of the United Arab Emirates as applicable in Dubai. Subject to mandatory law and any contrary written agreement, the courts of Dubai have jurisdiction over disputes arising from these terms.</p>
        <p>Contact <LegalContact /> with a concern so we can seek to resolve it. This does not limit rights or remedies that cannot be restricted under applicable law.</p>
      </>,
    },
    {
      id: "updates", title: "Changes and general provisions",
      content: <>
        <p>We may update these terms to reflect changes to Fabric or legal requirements. Approved terms will state their effective date. Material changes will be communicated as required by law or the customer agreement, and any required acceptance will be obtained before those changes apply.</p>
        <p>If a provision is unenforceable, the remaining provisions continue to apply to the extent permitted by law. A delay in enforcing a right does not waive it. Provisions concerning ownership, confidentiality, liability, disputes, and accrued obligations continue after access ends where their nature requires it.</p>
      </>,
    },
    {
      id: "contact", title: "Contact Biz Group",
      content: <p>For questions about these terms or the Fabric service, contact Biz Group, Dubai, United Arab Emirates, at <LegalContact />.</p>,
    },
  ],
};
