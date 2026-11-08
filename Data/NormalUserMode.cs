using System.Collections.Concurrent;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;

namespace Planszowkarz.Data;

/// <summary>
/// Admins who chose to use the app as a regular user, for testing the UI.
/// Kept in memory, so everyone is back to their real role after an app restart.
/// </summary>
public sealed class NormalUserMode
{
    private readonly ConcurrentDictionary<string, bool> activeUserIds = new();

    public bool IsActive(string userId) => activeUserIds.ContainsKey(userId);

    public void Set(string userId, bool active)
    {
        if (active)
        {
            activeUserIds[userId] = true;
        }
        else
        {
            activeUserIds.TryRemove(userId, out _);
        }
    }
}

/// <summary>
/// Removes the Admin (and Owner) role while the mode is active, so every role check in the app respects it.
/// It only ever removes the role, so being listed in the mode can't grant anything.
/// </summary>
public sealed class NormalUserModeClaimsTransformation(NormalUserMode mode) : IClaimsTransformation
{
    public Task<ClaimsPrincipal> TransformAsync(ClaimsPrincipal principal)
    {
        var userId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId is null || !mode.IsActive(userId))
        {
            return Task.FromResult(principal);
        }

        var clone = principal.Clone();
        foreach (var identity in clone.Identities)
        {
            var adminClaims = identity.FindAll(identity.RoleClaimType)
                .Where(c => c.Value is AppRoles.Admin or AppRoles.Owner)
                .ToList();
            foreach (var claim in adminClaims)
            {
                identity.RemoveClaim(claim);
            }
        }

        return Task.FromResult(clone);
    }
}
