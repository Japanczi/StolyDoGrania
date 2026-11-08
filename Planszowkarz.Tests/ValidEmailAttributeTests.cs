using Planszowkarz.Data;

namespace Planszowkarz.Tests;

/// <summary>Format rules of <see cref="ValidEmailAttribute"/>.</summary>
public class ValidEmailAttributeTests
{
    private static readonly ValidEmailAttribute Attr = new();

    [Theory]
    [InlineData("jan.nowak@example.com")]
    [InlineData("a_b%c+d-e@sub.example.co.uk")]
    [InlineData("x@a1.pl")]
    [InlineData("A@B-C.IO")]
    public void Accepts_valid_addresses(string email) => Assert.True(Attr.IsValid(email));

    [Theory]
    [InlineData("a@b")]
    [InlineData("a@b.c")]
    [InlineData("a@b.c1")]
    [InlineData("@example.com")]
    [InlineData("jan@")]
    [InlineData("a@@example.com")]
    [InlineData(".jan@example.com")]
    [InlineData("jan.@example.com")]
    [InlineData("ja..n@example.com")]
    [InlineData("jan@example..com")]
    [InlineData("jan@-example.com")]
    [InlineData("jan@example-.com")]
    [InlineData("jan@.example.com")]
    [InlineData("jan@example.com.")]
    [InlineData("jan nowak@example.com")]
    [InlineData(" jan@example.com")]
    [InlineData("jan@example.com ")]
    [InlineData("jan@exa mple.com")]
    [InlineData("jan@example.com\n")]
    [InlineData("zażółć@example.com")]
    public void Rejects_invalid_addresses(string email) => Assert.False(Attr.IsValid(email));

    [Fact]
    public void Null_empty_and_non_string_pass_so_Required_decides()
    {
        Assert.True(Attr.IsValid(null));
        Assert.True(Attr.IsValid(""));
        Assert.True(Attr.IsValid(42));
    }

    [Fact]
    public void Length_limit_is_254()
    {
        var domain = "@example.com";
        Assert.True(Attr.IsValid(new string('a', 254 - domain.Length) + domain));
        Assert.False(Attr.IsValid(new string('a', 255 - domain.Length) + domain));
    }

    [Fact]
    public void Domain_label_limit_is_63()
    {
        Assert.True(Attr.IsValid($"a@{new string('b', 63)}.com"));
        Assert.False(Attr.IsValid($"a@{new string('b', 64)}.com"));
    }

    [Fact]
    public void Error_message_is_polish() =>
        Assert.Equal("Podaj poprawny adres e-mail, np. jan.nowak@example.com.", Attr.FormatErrorMessage("Email"));
}
