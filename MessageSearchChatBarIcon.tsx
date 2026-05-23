/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { IconComponent } from "@utils/types";

import { openGlobalSearchModal } from "./MessageSearchModal";


export const SearchIcon: IconComponent = ({ height = 20, width = 20, className, children }) => (
    <svg fill="currentColor" className={className} width={width} height={height} viewBox="0 0 24 24">
        <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5A6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5S14 7.01 14 9.5S11.99 14 9.5 14z" />
        {children}
    </svg>
);

export const MessageSearchChatBarIcon: ChatBarButtonFactory = ({ isMainChat }) => {
    if (!isMainChat) return null; // Only render in the main chat bar. Almost messed this one up

    return (
        <ChatBarButton
            tooltip="Global Search"
            onClick={() => openGlobalSearchModal()}
            buttonProps={{
                "aria-label": "Global Search", // toby told me to add this
            }}
        >
            <SearchIcon />
        </ChatBarButton>
    );
};

