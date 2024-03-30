using FluentAssertions;
using Moq;
using ordermateAPI.DAL.Interfaces;
using ordermateAPI.DAL.Models;
using ordermateAPI.Enums;
using ordermateAPI.Exceptions;
using ordermateAPI.Models;
using ordermateAPI.Services;
using ordermateAPI.Services.Interfaces;
using ModifierModel = ordermateAPI.DAL.Models.ModifierModel;
using OrderModel = ordermateAPI.DAL.Models.OrderModel;
using ProductOptionModel = ordermateAPI.DAL.Models.ProductOptionModel;

namespace ordermateUnitTests;

[TestClass]
public class OrderServiceTests
{
    private readonly Mock<IOrderRepository> _mockOrderRepository = new Mock<IOrderRepository>();
    private readonly Mock<IOrderItemRepository> _mockOrderItemRepository = new Mock<IOrderItemRepository>();
    private readonly Mock<IOrderItemModifierRepository> _mockOrderItemModifierRepository = new Mock<IOrderItemModifierRepository>();
    private readonly Mock<IProductOptionRepository> _mockProductOptionRepository = new Mock<IProductOptionRepository>();
    private readonly Mock<IModifierRepository> _mockModifierRepository = new Mock<IModifierRepository>();
    private readonly Mock<IStoreRepository> _mockStoreRepository = new Mock<IStoreRepository>();
    private IOrderService? _orderService;
    
    [TestMethod]
    public async Task GivenValidOrderNumberWhenGettingOrderThenReturnsOrder()
    {
        var expectedDateTime = DateTime.UtcNow;
        _mockOrderRepository.Setup(x => x.Get(It.IsAny<string>()))
            .Returns(Task.FromResult(DefaultValidOrder(expectedDateTime))!);
        
        _orderService = new OrderService(_mockOrderRepository.Object, _mockOrderItemRepository.Object,
            _mockOrderItemModifierRepository.Object, _mockProductOptionRepository.Object,
            _mockModifierRepository.Object, _mockStoreRepository.Object);

        ordermateAPI.Models.OrderModel result = await _orderService.GetByOrderNumber("123");
        result.Should().BeEquivalentTo(new ordermateAPI.Models.OrderModel
        {
            OrderId = 1,
            StoreId = 1,
            OrderNumber = "123",
            Email = "test@gmail.com",
            Notes = "test notes",
            OrderStatus = OrderStatus.Basket,
            TotalValue = 5,
            CreatedDate = expectedDateTime,
            LastModifiedDate = expectedDateTime,
            CompletedDate = null
        });
    }

    [TestMethod]
    public async Task GivenValidRequestWhenCreatingOrderThenCreatesOrder()
    {
        _mockStoreRepository.Setup(x => x.Get(It.IsAny<int>())).Returns(Task.FromResult(new StoreModel
        {
            StoreId = 1
        })!);
        
        _orderService = new OrderService(_mockOrderRepository.Object, _mockOrderItemRepository.Object,
            _mockOrderItemModifierRepository.Object, _mockProductOptionRepository.Object,
            _mockModifierRepository.Object, _mockStoreRepository.Object);
        
        TestExtensions.DoesNotThrowException<Exception>(async () => await _orderService.Create("test@gmail.com", 1));
    }
    
    [TestMethod]
    public async Task GivenOrderItemDoesNotExistWhenAddingItemThenReturnsException()
    {
        var expectedDateTime = DateTime.UtcNow;
        _mockOrderRepository.Setup(x => x.Get(It.IsAny<int>()))
            .Returns(Task.FromResult(DefaultValidOrder(expectedDateTime)));

        _mockProductOptionRepository.Setup(x => x.Get(It.IsAny<int>()))
            .Returns(Task.FromResult(DefaultValidProductOptionModel(expectedDateTime)));

        _mockModifierRepository.Setup(x => x.Get(It.IsAny<int>()))
            .Returns(Task.FromResult(DefaultValidModifierModel(expectedDateTime)));

        _mockOrderItemRepository.Setup(x => x.GetAllOrderItemsByOrderId(It.IsAny<int>()))
            .Returns(Task.FromResult(DefaultValidOrderItems(expectedDateTime)));

        _mockOrderItemModifierRepository.Setup(x => x.GetAllByOrderItemId(It.IsAny<int>()))
            .Returns(Task.FromResult(DefaultValidOrderItemModifiers(expectedDateTime)));
        
        _orderService = new OrderService(_mockOrderRepository.Object, _mockOrderItemRepository.Object,
            _mockOrderItemModifierRepository.Object, _mockProductOptionRepository.Object,
            _mockModifierRepository.Object, _mockStoreRepository.Object);

        TestExtensions.DoesNotThrowException<Exception>(async () => await _orderService.AddItem(new AddOrderItemModel
        {
            OrderId = 1,
            ProductOptionId = 1,
            Modifiers = new List<AddOrderItemModel.OrderItemModifier>
            {
                new AddOrderItemModel.OrderItemModifier
                {
                    ModifierId = 1,
                    Quantity = 1
                }
            }
        }));
    }
    
    [TestMethod]
    public async Task GivenOrderItemExistsWhenAddingItemThenReturnsException()
    {
        var expectedDateTime = DateTime.UtcNow;
        _mockOrderRepository.Setup(x => x.Get(It.IsAny<int>()))
            .Returns(Task.FromResult(DefaultValidOrder(expectedDateTime)));

        _mockProductOptionRepository.Setup(x => x.Get(It.IsAny<int>()))
            .Returns(Task.FromResult(DefaultValidProductOptionModel(expectedDateTime)));

        _mockModifierRepository.Setup(x => x.Get(It.IsAny<int>()))
            .Returns(Task.FromResult(DefaultValidModifierModel(expectedDateTime)));

        _mockOrderItemRepository.Setup(x => x.Get(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<List<AddOrderItemModel.OrderItemModifier>>()))
            .Returns(Task.FromResult(DefaultValidOrderItem(expectedDateTime)));
        
        _mockOrderItemRepository.Setup(x => x.GetAllOrderItemsByOrderId(It.IsAny<int>()))
            .Returns(Task.FromResult(DefaultValidOrderItems(expectedDateTime)));

        _mockOrderItemModifierRepository.Setup(x => x.GetAllByOrderItemId(It.IsAny<int>()))
            .Returns(Task.FromResult(DefaultValidOrderItemModifiers(expectedDateTime)));
        
        _orderService = new OrderService(_mockOrderRepository.Object, _mockOrderItemRepository.Object,
            _mockOrderItemModifierRepository.Object, _mockProductOptionRepository.Object,
            _mockModifierRepository.Object, _mockStoreRepository.Object);

        TestExtensions.DoesNotThrowException<Exception>(async () => await _orderService.AddItem(new AddOrderItemModel
        {
            OrderId = 1,
            ProductOptionId = 1,
            Modifiers = new List<AddOrderItemModel.OrderItemModifier>
            {
                new AddOrderItemModel.OrderItemModifier
                {
                    ModifierId = 1,
                    Quantity = 1
                }
            }
        }));
    }
    
    [TestMethod]
    [ExpectedExceptionAssertion(typeof(OrderNotFoundException), "Could not find an order with the Order Number: 123")]
    public async Task GivenInvalidOrderNumberWhenGettingOrderThenReturnsException()
    {
        _mockOrderRepository.Setup(x => x.Get(It.IsAny<string>()))
            .Returns(Task.FromResult<ordermateAPI.DAL.Models.OrderModel?>(null));
        
        _orderService = new OrderService(_mockOrderRepository.Object, _mockOrderItemRepository.Object,
            _mockOrderItemModifierRepository.Object, _mockProductOptionRepository.Object,
            _mockModifierRepository.Object, _mockStoreRepository.Object);

        await _orderService.GetByOrderNumber("123");
    }
    
    [TestMethod]
    [ExpectedExceptionAssertion(typeof(InvalidEmailException), "Email Address must be supplied to create an order.")]
    public async Task GivenInvalidEmailWhenCreatingOrderThenReturnsException()
    {
        _orderService = new OrderService(_mockOrderRepository.Object, _mockOrderItemRepository.Object,
            _mockOrderItemModifierRepository.Object, _mockProductOptionRepository.Object,
            _mockModifierRepository.Object, _mockStoreRepository.Object);

        await _orderService.Create("", 1);
    }
    
    [TestMethod]
    [ExpectedExceptionAssertion(typeof(StoreNotFoundException), "Store with Id 1 not found.")]
    public async Task GivenInvalidStoreIdWhenCreatingOrderThenReturnsException()
    {
        _mockStoreRepository.Setup(x => x.Get(It.IsAny<int>()))
            .Returns(Task.FromResult<ordermateAPI.DAL.Models.StoreModel?>(null));
        
        _orderService = new OrderService(_mockOrderRepository.Object, _mockOrderItemRepository.Object,
            _mockOrderItemModifierRepository.Object, _mockProductOptionRepository.Object,
            _mockModifierRepository.Object, _mockStoreRepository.Object);

        await _orderService.Create("test@gmail.com", 1);
    }
    
    [TestMethod]
    [ExpectedExceptionAssertion(typeof(OrderNotFoundException), $"Could not find an order with Id: 1")]
    public async Task GivenInvalidOrderIdWhenAddingItemThenReturnsException()
    {
        _orderService = new OrderService(_mockOrderRepository.Object, _mockOrderItemRepository.Object,
            _mockOrderItemModifierRepository.Object, _mockProductOptionRepository.Object,
            _mockModifierRepository.Object, _mockStoreRepository.Object);

        await _orderService.AddItem(new AddOrderItemModel
        {
            OrderId = 1
        });
    }
    
    [TestMethod]
    [ExpectedExceptionAssertion(typeof(ProductOptionNotFoundException), $"Could not find a product option with Id: 1")]
    public async Task GivenInvalidProductOptionIdWhenAddingItemThenReturnsException()
    {
        var expectedDateTime = DateTime.UtcNow;
        _mockOrderRepository.Setup(x => x.Get(It.IsAny<int>()))
            .Returns(Task.FromResult(DefaultValidOrder(expectedDateTime))!);
        
        _orderService = new OrderService(_mockOrderRepository.Object, _mockOrderItemRepository.Object,
            _mockOrderItemModifierRepository.Object, _mockProductOptionRepository.Object,
            _mockModifierRepository.Object, _mockStoreRepository.Object);

        await _orderService.AddItem(new AddOrderItemModel
        {
            OrderId = 1,
            ProductOptionId = 1
        });
    }
    
    [TestMethod]
    [ExpectedExceptionAssertion(typeof(ModifierNotFoundException), $"Could not find a modifier with Id: 1")]
    public async Task GivenInvalidModifierIdWhenAddingItemThenReturnsException()
    {
        var expectedDateTime = DateTime.UtcNow;
        _mockOrderRepository.Setup(x => x.Get(It.IsAny<int>()))
            .Returns(Task.FromResult(DefaultValidOrder(expectedDateTime))!);

        _mockProductOptionRepository.Setup(x => x.Get(It.IsAny<int>()))
            .Returns(Task.FromResult(DefaultValidProductOptionModel(expectedDateTime)));
        
        _orderService = new OrderService(_mockOrderRepository.Object, _mockOrderItemRepository.Object,
            _mockOrderItemModifierRepository.Object, _mockProductOptionRepository.Object,
            _mockModifierRepository.Object, _mockStoreRepository.Object);

        await _orderService.AddItem(new AddOrderItemModel
        {
            OrderId = 1,
            ProductOptionId = 1,
            Modifiers = new List<AddOrderItemModel.OrderItemModifier>
            {
                new AddOrderItemModel.OrderItemModifier
                {
                    ModifierId = 1,
                    Quantity = 1
                }
            }
        });
    }

    private OrderModel? DefaultValidOrder(DateTime expectedDateTime)
    {
        return new OrderModel
        {
            OrderId = 1,
            StoreId = 1,
            OrderNumber = "123",
            Email = "test@gmail.com",
            Notes = "test notes",
            OrderStatus = 0,
            TotalValue = 5,
            CreatedDate = expectedDateTime,
            LastModifiedDate = expectedDateTime,
            CompletedDate = null
        };
    }

    private ProductOptionModel? DefaultValidProductOptionModel(DateTime expectedDateTime)
    {
        return new ProductOptionModel()
        {
            ProductOptionId = 1,
            ProductId = 1,
            Name = "Test",
            Price = 1,
            Quantity = -1,
            CreatedDate = expectedDateTime,
            LastModifiedDate = expectedDateTime,
        };
    }

    private ModifierModel? DefaultValidModifierModel(DateTime expectedDateTime)
    {
        return new ModifierModel()
        {
            ModifierId = 1,
            Name = "Test",
            Price = 1,
            Quantity = -1,
            CreatedDate = expectedDateTime,
            LastModifiedDate = expectedDateTime
        };
    }

    private IEnumerable<OrderItemModel> DefaultValidOrderItems(DateTime expectedDateTime)
    {
        return new List<OrderItemModel>()
        {
            DefaultValidOrderItem(expectedDateTime)!
        };
    }

    private OrderItemModel? DefaultValidOrderItem(DateTime expectedDateTime)
    {
        return new OrderItemModel()
        {
            OrderItemId = 1,
            OrderId = 1,
            ProductOptionId = 1,
            Quantity = 1,
            CreatedDate = expectedDateTime,
            LastModifiedDate = expectedDateTime
        };
    }

    private IEnumerable<OrderItemModifierModel> DefaultValidOrderItemModifiers(DateTime expectedDateTime)
    {
        return new List<OrderItemModifierModel>()
        {
            new OrderItemModifierModel
            {
                OrderItemModifierId = 1,
                OrderItemId = 1,
                ModifierId = 1,
                Quantity = -1,
                CreatedDate = expectedDateTime,
                LastModifiedDate = expectedDateTime
            }
        };
    }
}