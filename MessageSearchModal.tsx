/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import { findByPropsLazy } from "@webpack"; // Added findByPropsLazy
import { Button, ChannelRouter, ChannelStore, Constants, Forms, GuildStore, React, RestAPI, Text, TextInput, Toasts, useState } from "@webpack/common";

const Kangaroo = findByPropsLazy("jumpToMessage"); // Changed to findByPropsLazy with a single prop

const PAGE_SIZE = 25;
const GUILD_SEARCH_BATCH_SIZE = 5;

type SearchScope = "dms" | "allGuilds";

interface MessageAuthor {
    id: string;
    username: string;
    avatar: string | null;
}

interface MessageSearchModalProps extends ModalProps {
    // i dont remember why i added this
}

// structure of a search result item
interface SearchResultItem {
    id: string;
    content: string;
    author: MessageAuthor;
    channel_id: string;
    timestamp: string;
}

// structure for the messages tab data and for the cursor
interface MessagesTabData {
    messages: SearchResultItem[][];
    cursor?: string | null;
}

interface SearchResponse {
    tabs: {
        messages: MessagesTabData;
    };
}

interface GuildSearchResponse {
    messages: SearchResultItem[][];
    total_results?: number;
}

interface GuildSearchPageResult {
    guildId: string;
    messages: SearchResultItem[];
    nextOffset: number | null;
}

// avatar url function
const getAvatarUrl = (userId?: string, avatarHash?: string | null) => {
    if (!userId || !avatarHash) {
        // placeholder
        return `https://cdn.discordapp.com/embed/avatars/${(parseInt(userId || "0") % 5)}.png`;
    }
    const extension = avatarHash.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${extension}?size=32`;
};

const sortResultsByTimestamp = (results: SearchResultItem[]) => (
    [...results].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
);

const dedupeResults = (results: SearchResultItem[]) => {
    const seen = new Set<string>();
    return results.filter(result => {
        const key = `${result.channel_id}:${result.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

function MessageSearchModal(props: MessageSearchModalProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [searchScope, setSearchScope] = useState<SearchScope>("dms");
    const [nextMessagesCursor, setNextMessagesCursor] = useState<string | null>(null);
    const [allGuildResultsCache, setAllGuildResultsCache] = useState<SearchResultItem[]>([]);
    const [allGuildVisibleCount, setAllGuildVisibleCount] = useState(0);
    const [nextAllGuildOffsets, setNextAllGuildOffsets] = useState<Record<string, number>>({});
    const [allGuildProgress, setAllGuildProgress] = useState<string | null>(null);

    const allGuilds = Object.values(GuildStore.getGuilds());

    const resetSearchState = () => {
        setSearchResults([]);
        setNextMessagesCursor(null);
        setAllGuildResultsCache([]);
        setAllGuildVisibleCount(0);
        setNextAllGuildOffsets({});
        setAllGuildProgress(null);
    };

    const setScope = (scope: SearchScope) => {
        setSearchScope(scope);
        resetSearchState();
    };

    const handleNavigateToMessage = (channelId: string, messageId: string) => {
        // debugging kills
        if (ChannelRouter && typeof ChannelRouter.transitionToChannel === "function") {
            ChannelRouter.transitionToChannel(channelId); // use the imported module directly

            setTimeout(() => {
                if (Kangaroo && typeof Kangaroo.jumpToMessage === "function") {
                    Kangaroo.jumpToMessage({
                        channelId,
                        messageId,
                        flash: false,
                        jumpType: "INSTANT"
                    });
                    setTimeout(() => {
                        props.onClose();
                    }, 300);
                } else {
                    console.error("[MessageSearch] Kangaroo module or jumpToMessage function not available when trying to jump.", Kangaroo);
                    alert("Failed to navigate: Kangaroo module (for message jump) not available.");
                }
            }, 700);
        } else {
            console.error("[MessageSearch] ChannelRouter module or transitionToChannel function not available from @webpack/common.", ChannelRouter);
        }
    };

    const fetchGuildSearchPage = async (guildId: string, offset: number): Promise<GuildSearchPageResult> => {
        const response = await RestAPI.get({
            url: Constants.Endpoints.SEARCH_GUILD(guildId),
            query: {
                content: searchQuery,
                sort_by: "timestamp",
                sort_order: "desc",
                offset,
                limit: PAGE_SIZE
            }
        });

        const data = response.body as GuildSearchResponse | null;
        if (!data || !data.messages) {
            throw new Error(`Search failed for guild ${guildId}: invalid response body`);
        }

        const messages = data.messages.flat();
        const loadedCount = offset + messages.length;
        const hasMoreGuildResults = typeof data.total_results === "number"
            ? loadedCount < data.total_results
            : messages.length >= PAGE_SIZE;

        return {
            guildId,
            messages,
            nextOffset: hasMoreGuildResults ? loadedCount : null
        };
    };

    const fetchAllGuildSearchPages = async (
        guildOffsets: Record<string, number>,
        progressLabel: string
    ) => {
        const entries = Object.entries(guildOffsets);
        const collected: SearchResultItem[] = [];
        const nextOffsets: Record<string, number> = {};
        let failedGuilds = 0;
        let processedGuilds = 0;

        setAllGuildProgress(`${progressLabel} 0/${entries.length} servers checked`);

        for (let i = 0; i < entries.length; i += GUILD_SEARCH_BATCH_SIZE) {
            const batch = entries.slice(i, i + GUILD_SEARCH_BATCH_SIZE);
            const results = await Promise.allSettled(batch.map(([guildId, offset]) => fetchGuildSearchPage(guildId, offset)));

            results.forEach((result, index) => {
                if (result.status === "fulfilled") {
                    collected.push(...result.value.messages);
                    if (result.value.nextOffset !== null) {
                        nextOffsets[result.value.guildId] = result.value.nextOffset;
                    }
                } else {
                    failedGuilds++;
                    console.error(`[MessageSearch] Failed to search guild ${batch[index][0]}`, result.reason);
                }
            });

            processedGuilds += batch.length;
            setAllGuildProgress(
                `${progressLabel} ${processedGuilds}/${entries.length} servers checked, ${collected.length} result${collected.length === 1 ? "" : "s"} found`
            );
        }

        return { collected, nextOffsets, failedGuilds };
    };

    const handleSearch = async () => {
        if (!searchQuery.trim()) return;
        setIsLoading(true);
        resetSearchState();

        try {
            if (searchScope === "dms") {
                const requestBody = {
                    tabs: {
                        messages: {
                            sort_by: "timestamp",
                            sort_order: "desc",
                            content: searchQuery,
                            cursor: null,
                            limit: PAGE_SIZE,
                        }
                    },
                    track_exact_total_hits: false,
                };

                const response = await RestAPI.post({
                    url: "/users/@me/messages/search/tabs",
                    body: requestBody,
                    oldFormErrors: true,
                });

                const data = response.body as SearchResponse | null;

                if (!data || !data.tabs?.messages?.messages) {
                    alert("Search failed: Server returned no usable data. Check console for details.");
                    return;
                }

                setSearchResults(data.tabs.messages.messages.flat());
                setNextMessagesCursor(data.tabs.messages.cursor || null);
                return;
            }

            if (!allGuilds.length) {
                Toasts.show({
                    id: Toasts.genId(),
                    type: Toasts.Type.FAILURE,
                    message: "No servers are available to search."
                });
                return;
            }

            const guildOffsets = allGuilds.reduce((acc, guild) => {
                acc[guild.id] = 0;
                return acc;
            }, {} as Record<string, number>);

            const { collected, nextOffsets, failedGuilds } = await fetchAllGuildSearchPages(guildOffsets, "Searching");
            const mergedResults = sortResultsByTimestamp(dedupeResults(collected));
            const initialVisibleCount = Math.min(PAGE_SIZE, mergedResults.length);

            setAllGuildResultsCache(mergedResults);
            setAllGuildVisibleCount(initialVisibleCount);
            setNextAllGuildOffsets(nextOffsets);
            setSearchResults(mergedResults.slice(0, initialVisibleCount));
            setAllGuildProgress(
                `Searched ${allGuilds.length} servers. Found ${mergedResults.length} result${mergedResults.length === 1 ? "" : "s"}.`
            );

            if (failedGuilds > 0) {
                Toasts.show({
                    id: Toasts.genId(),
                    type: Toasts.Type.FAILURE,
                    message: `Search failed in ${failedGuilds} server${failedGuilds === 1 ? "" : "s"}. Partial results shown.`
                });
            }
        } catch (error: any) {
            console.error("[MessageSearch] Error during search operation:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleLoadMore = async () => {
        if (isLoading) return;

        if (searchScope === "dms" && nextMessagesCursor) {
            setIsLoading(true);

            try {
                const requestBody = {
                    tabs: {
                        messages: {
                            sort_by: "timestamp",
                            sort_order: "desc",
                            content: searchQuery,
                            cursor: nextMessagesCursor,
                            limit: PAGE_SIZE,
                        }
                    },
                    track_exact_total_hits: false,
                };

                const response = await RestAPI.post({
                    url: "/users/@me/messages/search/tabs",
                    body: requestBody,
                    oldFormErrors: true,
                });

                const data = response.body as SearchResponse | null;
                if (!data || !data.tabs?.messages?.messages) return;

                setSearchResults(prevResults => [...prevResults, ...data.tabs.messages.messages.flat()]);
                setNextMessagesCursor(data.tabs.messages.cursor || null);
            } catch (error: any) {
                console.error("[MessageSearch] Error loading more DM results:", error);
            } finally {
                setIsLoading(false);
            }

            return;
        }

        if (searchScope !== "allGuilds") return;

        if (allGuildVisibleCount < allGuildResultsCache.length) {
            const nextVisibleCount = Math.min(allGuildVisibleCount + PAGE_SIZE, allGuildResultsCache.length);
            setAllGuildVisibleCount(nextVisibleCount);
            setSearchResults(allGuildResultsCache.slice(0, nextVisibleCount));
            return;
        }

        const guildIdsWithMoreResults = Object.keys(nextAllGuildOffsets);
        if (!guildIdsWithMoreResults.length) return;

        setIsLoading(true);

        try {
            const { collected, nextOffsets, failedGuilds } = await fetchAllGuildSearchPages(nextAllGuildOffsets, "Loading more from");
            const mergedResults = sortResultsByTimestamp(dedupeResults([...allGuildResultsCache, ...collected]));
            const nextVisibleCount = Math.min(allGuildVisibleCount + PAGE_SIZE, mergedResults.length);

            setAllGuildResultsCache(mergedResults);
            setAllGuildVisibleCount(nextVisibleCount);
            setNextAllGuildOffsets(nextOffsets);
            setSearchResults(mergedResults.slice(0, nextVisibleCount));
            setAllGuildProgress(
                `Loaded ${nextVisibleCount} of ${mergedResults.length} results across all servers.`
            );

            if (failedGuilds > 0) {
                Toasts.show({
                    id: Toasts.genId(),
                    type: Toasts.Type.FAILURE,
                    message: `Search failed in ${failedGuilds} server${failedGuilds === 1 ? "" : "s"} while loading more results.`
                });
            }
        } catch (error: any) {
            console.error("[MessageSearch] Error loading more global server results:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const getChannelContext = (channelId: string) => {
        const channel = ChannelStore.getChannel(channelId);
        if (!channel) {
            return {
                guildName: "Unknown Location",
                channelName: channelId
            };
        }

        if (!channel.guild_id) {
            return {
                guildName: "Direct Messages",
                channelName: channel.name || "Direct Message"
            };
        }

        return {
            guildName: GuildStore.getGuild(channel.guild_id)?.name || "Unknown Server",
            channelName: channel.name ? `#${channel.name}` : channelId
        };
    };

    return (
        <ModalRoot {...props} size={ModalSize.LARGE}>
            <ModalHeader>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%", gap: "16px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
                        <Forms.FormTitle tag="h2" style={{ margin: 0 }}>
                            Global Search
                        </Forms.FormTitle>
                        <Forms.FormText style={{ margin: 0, fontStyle: "italic", fontSize: "0.9em", color: "var(--text-normal)" }}>
                            by Jaisal (AtomicByte)
                        </Forms.FormText>
                    </div>
                    <ModalCloseButton onClick={props.onClose} />
                </div>
            </ModalHeader>
            <ModalContent>
                <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
                    <button
                        type="button"
                        onClick={() => setScope("dms")}
                        style={{
                            padding: "8px 12px",
                            borderRadius: "8px",
                            border: "1px solid var(--background-modifier-accent)",
                            background: searchScope === "dms" ? "var(--brand-500)" : "var(--background-secondary)",
                            color: "white",
                            fontWeight: 600,
                            cursor: "pointer"
                        }}
                    >
                        DMs
                    </button>
                    <button
                        type="button"
                        onClick={() => setScope("allGuilds")}
                        disabled={!allGuilds.length}
                        style={{
                            padding: "8px 12px",
                            borderRadius: "8px",
                            border: "1px solid var(--background-modifier-accent)",
                            background: searchScope === "allGuilds" ? "var(--brand-500)" : "var(--background-secondary)",
                            color: "white",
                            fontWeight: 600,
                            cursor: allGuilds.length ? "pointer" : "not-allowed",
                            opacity: allGuilds.length ? 1 : 0.5
                        }}
                    >
                        All Servers
                    </button>
                </div>

                <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
                    <TextInput
                        placeholder={
                            searchScope === "dms"
                                ? "Search all DMs..."
                                : "Search all servers..."
                        }
                        value={searchQuery}
                        onChange={setSearchQuery}
                        onKeyDown={e => {
                            if (e.key === "Enter") void handleSearch();
                        }}
                        style={{ flexGrow: 1 }}
                    />
                    <Button onClick={() => handleSearch()} disabled={isLoading}>
                        {isLoading ? "Searching..." : "Search"}
                    </Button>
                </div>

                {searchScope === "allGuilds" && allGuildProgress && (
                    <Forms.FormText style={{ marginBottom: "16px", color: "var(--text-normal)" }}>
                        {allGuildProgress}
                    </Forms.FormText>
                )}

                <div>
                    {searchResults.length === 0 && !isLoading && (
                        <Forms.FormText>No results found, or search not yet performed.</Forms.FormText>
                    )}
                    {searchResults.map((item: SearchResultItem) => {
                        const context = getChannelContext(item.channel_id);
                        return (
                            <div
                                key={item.id}
                                style={{
                                    marginBottom: "10px",
                                    padding: "10px",
                                    border: "1px solid var(--background-modifier-accent)",
                                    borderRadius: "5px",
                                    cursor: "pointer"
                                }}
                                onClick={() => handleNavigateToMessage(item.channel_id, item.id)}
                            >
                                <div style={{ display: "flex", alignItems: "center", marginBottom: "5px" }}>
                                    <img
                                        src={getAvatarUrl(item.author.id, item.author.avatar)}
                                        alt={`${item.author.username}'s avatar`}
                                        style={{
                                            width: "32px",
                                            height: "32px",
                                            borderRadius: "50%",
                                            marginRight: "10px",
                                            objectFit: "cover"
                                        }}
                                    />
                                    <Text color="header-primary" variant="text-md/semibold">{item.author.username}</Text>
                                    <Text color="text-muted" style={{ marginLeft: "10px", fontSize: "0.8em" }}>
                                        {new Date(item.timestamp).toLocaleString()}
                                    </Text>
                                </div>
                                <Text color="text-normal" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{item.content}</Text>
                                <Forms.FormText style={{ fontSize: "0.75em", marginTop: "5px", color: "var(--text-muted)" }}>
                                    {context.guildName} | {context.channelName}
                                </Forms.FormText>
                            </div>
                        );
                    })}
                </div>
            </ModalContent>
            <ModalFooter>
                {searchScope === "dms" && nextMessagesCursor && !isLoading && (
                    <Button onClick={handleLoadMore} disabled={isLoading}>
                        Load More
                    </Button>
                )}
                {searchScope === "allGuilds" && (allGuildVisibleCount < allGuildResultsCache.length || Object.keys(nextAllGuildOffsets).length > 0) && !isLoading && (
                    <Button onClick={handleLoadMore} disabled={isLoading}>
                        Load More
                    </Button>
                )}
            </ModalFooter>
        </ModalRoot>
    );
}

export function openGlobalSearchModal() {
    openModal(props => <MessageSearchModal {...props} />);
}
