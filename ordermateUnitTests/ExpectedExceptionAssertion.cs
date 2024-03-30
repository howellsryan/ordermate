namespace ordermateUnitTests;

public class ExpectedExceptionAssertion: ExpectedExceptionBaseAttribute
{
    private Type _expectedExceptionType;
    private string _expectedExceptionMessage;

    public ExpectedExceptionAssertion(Type expectedExceptionType)
    {
        _expectedExceptionType = expectedExceptionType;
        _expectedExceptionMessage = string.Empty;
    }

    public ExpectedExceptionAssertion(Type expectedExceptionType, string expectedExceptionMessage)
    {
        _expectedExceptionType = expectedExceptionType;
        _expectedExceptionMessage = expectedExceptionMessage;
    }

    protected override void Verify(Exception exception)
    {
        Assert.IsNotNull(exception);
        Assert.IsInstanceOfType(exception, _expectedExceptionType, "Wrong type of exception was thrown.");
        Assert.AreEqual(_expectedExceptionMessage, exception.Message, "Wrong exception message was returned.");
    }
}